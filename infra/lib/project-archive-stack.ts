import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Annotations,
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_apigatewayv2 as apigwv2,
  aws_cloudwatch as cloudwatch,
  aws_cloudwatch_actions as cloudwatchActions,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrassets,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_logs as logs,
  aws_rds as rds,
  aws_secretsmanager as secretsmanager,
  aws_sns as sns,
  aws_sns_subscriptions as subscriptions,
} from "aws-cdk-lib";
import { HttpAlbIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { Construct } from "constructs";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");

/**
 * Secrets Manager secrets this stack imports but does not create, and the JSON
 * keys each one must hold.
 *
 * They are imported rather than created because their VALUES are credentials
 * nobody in this repository may mint: a Google client secret, a TrueFoundry key,
 * a signing key. `fromSecretNameV2` resolves at deploy time, so a secret that
 * does not exist is not a synth error — it is an ECS task that cannot start,
 * discovered after the deploy has begun. `scripts/check-secrets.ts` runs ahead
 * of `cdk deploy` for exactly that reason, over the `REQUIRED_SECRETS` table
 * below rather than over a second copy of these names.
 */
const GOOGLE_OAUTH_SECRET = "project-archive/google-oauth";
/**
 * Named for the formative grader that has since been deleted; it now supplies
 * only `csrfSecret`. Its `encryptionKeyBase64` key was injected as
 * `GRADING_ENCRYPTION_KEY_BASE64` and no code has read that variable since the
 * envelope-encryption module was removed, so the injection is gone and the key
 * is no longer required to start a task.
 */
const APP_SECRET = "project-archive/formative-grading";
/**
 * The duel-verdict receipt signing key, on its own.
 *
 * @pa/grading's `verdictReceiptSecret()` reads `GRADING_RECEIPT_SECRET` and, if
 * it is unset, derives one from `SESSION_SECRET`. Neither was injected here, so
 * every call threw and the boss duel could not sign a verdict at all — and a
 * verdict receipt is what stops a modified client flipping WRONG to CORRECT on
 * its way to the commit. Its own secret rather than another key on
 * `project-archive/formative-grading`, because a key with one job can be rotated
 * without rewriting the CSRF secret beside it.
 */
const VERDICT_RECEIPT_SECRET = "project-archive/verdict-receipt";
/**
 * The classifier credential, on its own.
 *
 * Separate from the image-generation key (`TRUEFOUNDRY_API_KEY`) on purpose, and
 * @pa/grading refuses to fall back to that one in production. The measured
 * reason is capacity rather than tidiness: the gateway serialises, 1516ms at
 * concurrency 3 against a 1.5-second cap, so a class of thirty sitting behind
 * the same virtual key as an asset render takes the generous fallback instead of
 * a grade. This secret's value must be a TrueFoundry key provisioned with its
 * own rate limit.
 */
const GRADING_CREDENTIAL_SECRET = "project-archive/grading-credential";

/** Secret name -> required JSON keys. Read by scripts/check-secrets.ts. */
export const REQUIRED_SECRETS: Readonly<Record<string, readonly string[]>> = {
  [GOOGLE_OAUTH_SECRET]: ["clientId", "clientSecret"],
  [APP_SECRET]: ["csrfSecret"],
  [VERDICT_RECEIPT_SECRET]: ["receiptSecret"],
  [GRADING_CREDENTIAL_SECRET]: ["apiKey"],
};

/**
 * The structured log line the API emits once per graded duel round, and the
 * CloudWatch metrics derived from it.
 *
 * This pair of strings is the whole join between the application and the alarm.
 * `apps/api/src/duels/gradingSignal.ts` writes the field names and
 * `apps/api/test/grading-signal.test.ts` asserts this file still matches them,
 * because a renamed field does not break anything visible — it silently produces
 * a metric that is always zero, which is indistinguishable from healthy grading.
 */
const GRADING_LOG_MARKER = "duel_grading_round";
const GRADING_METRIC_NAMESPACE = "ProjectArchive/Grading";
const GRADED_ROUNDS_METRIC = "GradedRounds";
const GRADING_FALLBACKS_METRIC = "GradingFallbacks";

/**
 * Where the browser talks to this API from, and whether session cookies may
 * travel in the clear.
 *
 * These are configuration, never defaults. A localhost fallback here is exactly
 * how a stack reaches a real environment with Google OAuth redirecting to a
 * developer's laptop and session cookies missing the Secure attribute, and
 * neither failure is visible from the outside until someone's session is
 * stolen. So every value is required, synth fails loudly when one is missing,
 * and cookies are secure unless insecurity is asked for explicitly and can be
 * shown to be local.
 *
 * Deploying to a real origin:
 *   PA_WEB_ORIGIN=https://archive.example.org \
 *   PA_GOOGLE_REDIRECT_URI=https://archive.example.org/v1/auth/google/callback \
 *     pnpm aws:deploy
 *
 * Running the web app locally against the deployed API, which is the current
 * workflow and the only case where cookies may lack Secure:
 *   PA_WEB_ORIGIN=http://localhost:5173 \
 *   PA_GOOGLE_REDIRECT_URI=http://localhost:5173/v1/auth/google/callback \
 *   PA_ALLOW_INSECURE_COOKIES=true \
 *     pnpm aws:deploy
 *
 * Either may be passed as CDK context instead:
 *   pnpm aws:deploy -- -c webOrigin=... -c googleRedirectUri=...
 */
interface ApiOrigins {
  readonly webOrigin: string;
  readonly googleRedirectUri: string;
  readonly cookieSecure: boolean;
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

function requiredSetting(scope: Construct, context: string, envVar: string): string {
  const raw = scope.node.tryGetContext(context) ?? process.env[envVar];
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) {
    throw new Error(
      `Missing deployment setting ${context}. Pass it as CDK context ` +
        `(-c ${context}=...) or set ${envVar} in the deploy environment. ` +
        `There is deliberately no default: the previous localhost default ` +
        `shipped a task definition whose OAuth redirect pointed at a laptop.`,
    );
  }
  return value;
}

/**
 * Where an alarm goes.
 *
 * Optional, and the absence is ANNOUNCED at synth rather than defaulted away: an
 * alarm with no action is a red square on a console nobody has open during a
 * lesson, which is the same failure as the review log this stack is trying to
 * stop relying on.
 *
 *   PA_ALERT_EMAIL=ops@example.org pnpm aws:deploy
 *
 * The address receives a confirmation mail from SNS and must accept it before
 * anything is delivered.
 */
function resolveAlertEmail(scope: Construct): string | null {
  const raw = scope.node.tryGetContext("alertEmail") ?? process.env.PA_ALERT_EMAIL;
  const value = typeof raw === "string" ? raw.trim() : "";
  return value.length > 0 ? value : null;
}

function resolveApiOrigins(scope: Construct): ApiOrigins {
  const webOrigin = requiredSetting(scope, "webOrigin", "PA_WEB_ORIGIN");
  const googleRedirectUri = requiredSetting(
    scope,
    "googleRedirectUri",
    "PA_GOOGLE_REDIRECT_URI",
  );
  const optedOutOfSecureCookies =
    (scope.node.tryGetContext("allowInsecureCookies") ??
      process.env.PA_ALLOW_INSECURE_COOKIES) === "true";
  const isLocal = LOCAL_ORIGIN.test(webOrigin);

  if (!isLocal && !webOrigin.startsWith("https://")) {
    throw new Error(
      `webOrigin must be https:// (got ${webOrigin}). Student sessions ride on ` +
        `cookies; a plaintext origin cannot hold them safely.`,
    );
  }
  // The web app proxies /v1 to this API, so a redirect URI on a different
  // origin than the app means the OAuth callback lands somewhere that cannot
  // set the session cookie.
  if (!googleRedirectUri.startsWith(`${webOrigin}/`)) {
    throw new Error(
      `googleRedirectUri (${googleRedirectUri}) must be a path on webOrigin ` +
        `(${webOrigin}). It must also be registered verbatim in the Google ` +
        `Cloud console.`,
    );
  }
  if (optedOutOfSecureCookies && !isLocal) {
    throw new Error(
      `allowInsecureCookies is only permitted with a localhost webOrigin, and ` +
        `webOrigin is ${webOrigin}. Remove the opt-out for any deployed origin.`,
    );
  }

  return { webOrigin, googleRedirectUri, cookieSecure: !optedOutOfSecureCookies };
}

export class ProjectArchiveStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    if (this.account !== "056956104102") {
      throw new Error(`Refusing to deploy to non-sandbox account ${this.account}`);
    }

    // Resolved before anything is provisioned, so a misconfigured origin fails
    // at synth rather than after a deploy has already replaced the service.
    const origins = resolveApiOrigins(this);

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: "application",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24,
        },
        {
          name: "database",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    const databaseSecurityGroup = new ec2.SecurityGroup(this, "DatabaseSecurityGroup", {
      vpc,
      allowAllOutbound: false,
      description: "RDS accepts PostgreSQL only from the Project Archive API",
    });
    const database = new rds.DatabaseInstance(this, "Database", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [databaseSecurityGroup],
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of("17.10", "17"),
      }),
      credentials: rds.Credentials.fromGeneratedSecret("project_archive"),
      databaseName: "project_archive",
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.BURSTABLE4_GRAVITON,
        ec2.InstanceSize.MICRO,
      ),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageEncrypted: true,
      storageType: rds.StorageType.GP3,
      multiAz: false,
      publiclyAccessible: false,
      backupRetention: Duration.days(7),
      deleteAutomatedBackups: false,
      deletionProtection: false,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });

    const googleOAuthSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GoogleOAuthSecret",
      GOOGLE_OAUTH_SECRET,
    );
    const appSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "FormativeGradingSecret",
      APP_SECRET,
    );
    const verdictReceiptSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "VerdictReceiptSecret",
      VERDICT_RECEIPT_SECRET,
    );
    const gradingCredentialSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "GradingCredentialSecret",
      GRADING_CREDENTIAL_SECRET,
    );

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
    const taskSecurityGroup = new ec2.SecurityGroup(this, "TaskSecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "Project Archive API tasks",
    });
    databaseSecurityGroup.addIngressRule(
      taskSecurityGroup,
      ec2.Port.tcp(5432),
      "PostgreSQL from API tasks",
    );

    const taskDefinition = new ecs.FargateTaskDefinition(this, "ApiTaskDefinition", {
      cpu: 512,
      memoryLimitMiB: 1024,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });
    const logGroup = new logs.LogGroup(this, "ApiLogGroup", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const image = ecs.ContainerImage.fromAsset(repositoryRoot, {
      file: "apps/api/Dockerfile",
      platform: ecrassets.Platform.LINUX_ARM64,
    });
    const container = taskDefinition.addContainer("Api", {
      image,
      logging: ecs.LogDrivers.awsLogs({
        logGroup,
        streamPrefix: "api",
      }),
      environment: {
        NODE_ENV: "production",
        API_HOST: "0.0.0.0",
        API_PORT: "3001",
        WEB_ORIGIN: origins.webOrigin,
        GOOGLE_REDIRECT_URI: origins.googleRedirectUri,
        COOKIE_SECURE: String(origins.cookieSecure),
        DB_HOST: database.dbInstanceEndpointAddress,
        DB_PORT: database.dbInstanceEndpointPort,
        DB_NAME: "project_archive",
        DB_SSL: "true",
        DB_SSL_REJECT_UNAUTHORIZED: "true",
        DB_POOL_MAX: "10",
        TRUEFOUNDRY_GRADING_BASE_URL:
          "https://tfy.promptlens.trilogy.com/v1",
        // Chosen by measurement and not by price list. The previous value here,
        // `aws-bedrock/us.amazon.nova-micro-v1-0`, measured a 15% FALSE-NEGATIVE
        // rate on the eval set — correct answers marked wrong, including a
        // student whose only error was writing 1863 for 1763, which the official
        // scoring guide credits. That is the toxic direction: a student who knew
        // the material and lost a ranked duel to the grader does not come back.
        // Flash Lite passes at 98.7% with 0.7% false negatives and is faster.
        // @pa/grading's DEFAULT_GRADING_MODEL holds the same value; it is stated
        // here so the deployed task does not depend on a library default.
        TRUEFOUNDRY_GRADING_MODEL: "gemini-group/gemini-3.5-flash-lite",
        TRUEFOUNDRY_GRADING_STRUCTURED_OUTPUT: "true",
        // How loud a lesson's fallback rate has to be before the API says so in
        // its own logs, ahead of the CloudWatch alarm below. Both exist: the
        // alarm reaches a human who is not watching, the log line reaches the
        // one who is.
        GRADING_FALLBACK_ALERT_PERCENT: "25",
        // AUDIT counts unsigned duel verdicts at the commit and lets them
        // through; REQUIRE refuses them. It stays AUDIT until the web client
        // carries `x-pa-verdict-receipt` into the commit log, because refusing
        // first would cost every student their mission clear.
        DUEL_RECEIPT_ENFORCEMENT: "AUDIT",
      },
      secrets: {
        DB_USER: ecs.Secret.fromSecretsManager(database.secret!, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(database.secret!, "password"),
        GOOGLE_CLIENT_ID: ecs.Secret.fromSecretsManager(googleOAuthSecret, "clientId"),
        GOOGLE_CLIENT_SECRET: ecs.Secret.fromSecretsManager(googleOAuthSecret, "clientSecret"),
        TRUEFOUNDRY_GRADING_API_KEY: ecs.Secret.fromSecretsManager(
          gradingCredentialSecret,
          "apiKey",
        ),
        // Without this the boss duel cannot sign a verdict, and an unsigned
        // verdict is one the commit path has no way to authenticate.
        GRADING_RECEIPT_SECRET: ecs.Secret.fromSecretsManager(
          verdictReceiptSecret,
          "receiptSecret",
        ),
        CSRF_SECRET: ecs.Secret.fromSecretsManager(appSecret, "csrfSecret"),
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          "node -e \"fetch('http://127.0.0.1:3001/v1/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\"",
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(60),
      },
    });
    container.addPortMappings({ containerPort: 3001 });

    const service = new ecs.FargateService(this, "ApiService", {
      cluster,
      taskDefinition,
      desiredCount: 1,
      assignPublicIp: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [taskSecurityGroup],
      enableExecuteCommand: true,
      circuitBreaker: { rollback: true },
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
    });
    // ---- where an alarm goes --------------------------------------------
    //
    // Until now every alarm in this stack had no action, so all three of them
    // amounted to a colour on a console. That is the same shape of problem as
    // the grading review log: recorded, never delivered.
    const alertEmail = resolveAlertEmail(this);
    const alerts = new sns.Topic(this, "Alerts", {
      displayName: "Project Archive operational alerts",
    });
    if (alertEmail === null) {
      Annotations.of(this).addWarning(
        "No alert destination: set PA_ALERT_EMAIL (or -c alertEmail=...) or the " +
          "grading-fallback alarm will fire into an empty SNS topic. A grading " +
          "outage grants every student a full magazine and is otherwise silent.",
      );
    } else {
      alerts.addSubscription(new subscriptions.EmailSubscription(alertEmail));
    }
    const alarmAction = new cloudwatchActions.SnsAction(alerts);
    const alarming = (alarm: cloudwatch.IAlarm): void => {
      // Both directions. An alarm that never says it recovered trains people to
      // ignore the one that says it fired.
      (alarm as cloudwatch.Alarm).addAlarmAction(alarmAction);
      (alarm as cloudwatch.Alarm).addOkAction(alarmAction);
    };

    alarming(
      new cloudwatch.Alarm(this, "ApiCpuHigh", {
        metric: service.metricCpuUtilization({ period: Duration.minutes(5) }),
        threshold: 85,
        evaluationPeriods: 3,
        datapointsToAlarm: 3,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    );
    alarming(
      new cloudwatch.Alarm(this, "DatabaseFreeStorageLow", {
        metric: database.metricFreeStorageSpace({ period: Duration.minutes(5) }),
        threshold: 2 * 1024 * 1024 * 1024,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        evaluationPeriods: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    );

    // ---- the grading fallback rate --------------------------------------
    //
    // THE PROBLEM THIS SOLVES. Grading grants the MAXIMUM on timeout, which is
    // the right rule — freezing a student mid-gunfight on a model call is worse
    // than being generous — and it means an unreachable gateway is
    // indistinguishable from a class of geniuses. /v1/health stays green,
    // because the database is fine and the API is answering; the only trace is a
    // review log line, and nobody reads a log during a lesson.
    //
    // WHY NOT THE HEALTH CHECK. Failing /v1/health on a grading outage would
    // make the load balancer kill the task and end the lesson, over a condition
    // the design deliberately degrades gracefully. Grading being down must never
    // take the API down. So the signal is a metric, not a status code.
    //
    // The metrics come off the API's own per-round log line rather than from a
    // PutMetricData call, which keeps the task free of the CloudWatch SDK and an
    // IAM policy, and means the number and the log entry can never disagree.
    const roundsMetric = new logs.MetricFilter(this, "GradedRoundsFilter", {
      logGroup,
      // One line per graded round, whatever the outcome. This is the
      // denominator, and without it a fallback COUNT cannot become a RATE.
      filterPattern: logs.FilterPattern.stringValue(
        "$.paMetric",
        "=",
        GRADING_LOG_MARKER,
      ),
      metricNamespace: GRADING_METRIC_NAMESPACE,
      metricName: GRADED_ROUNDS_METRIC,
      metricValue: "$.graded",
      defaultValue: 0,
    }).metric({ statistic: "Sum", period: Duration.minutes(5) });

    const fallbacksMetric = new logs.MetricFilter(this, "GradingFallbacksFilter", {
      logGroup,
      filterPattern: logs.FilterPattern.stringValue(
        "$.paMetric",
        "=",
        GRADING_LOG_MARKER,
      ),
      metricNamespace: GRADING_METRIC_NAMESPACE,
      metricName: GRADING_FALLBACKS_METRIC,
      // 1 on the same line when the round was granted without being graded, 0
      // otherwise, so numerator and denominator are always the same population.
      metricValue: "$.fallback",
      defaultValue: 0,
    }).metric({ statistic: "Sum", period: Duration.minutes(5) });

    // The rate, guarded against a tiny denominator. Five rounds in five minutes
    // is one student mid-duel; alarming on 100% of two rounds would page
    // somebody every time a laptop lid closed.
    alarming(
      new cloudwatch.Alarm(this, "GradingFallbackRateHigh", {
        alarmDescription:
          "More than a quarter of duel rounds were granted the maximum without " +
          "being graded. Students are being handed full magazines for any answer. " +
          "Check TRUEFOUNDRY_GRADING_API_KEY and the gateway before the next lesson.",
        metric: new cloudwatch.MathExpression({
          expression: "IF(rounds >= 5, 100 * fallbacks / rounds, 0)",
          usingMetrics: { rounds: roundsMetric, fallbacks: fallbacksMetric },
          period: Duration.minutes(5),
          label: "Ungraded duel rounds (%)",
        }),
        threshold: 25,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 2,
        datapointsToAlarm: 2,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    );

    // The outage alarm, which has to be faster than the rate alarm because this
    // is the shape a dead gateway takes: everything falls back at once.
    alarming(
      new cloudwatch.Alarm(this, "GradingUnreachable", {
        alarmDescription:
          "Twenty or more duel rounds in five minutes were granted without " +
          "grading. Treat as a grading outage in progress.",
        metric: fallbacksMetric,
        threshold: 20,
        comparisonOperator:
          cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      }),
    );

    const loadBalancerSecurityGroup = new ec2.SecurityGroup(
      this,
      "LoadBalancerSecurityGroup",
      {
        vpc,
        allowAllOutbound: true,
        description: "Internal API load balancer",
      },
    );
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroup: loadBalancerSecurityGroup,
    });
    const listener = loadBalancer.addListener("HttpListener", {
      port: 80,
      open: false,
    });
    listener.addTargets("ApiTargets", {
      port: 3001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      healthCheck: {
        path: "/v1/health",
        healthyHttpCodes: "200",
        interval: Duration.seconds(30),
      },
      deregistrationDelay: Duration.seconds(30),
    });
    taskSecurityGroup.addIngressRule(
      loadBalancerSecurityGroup,
      ec2.Port.tcp(3001),
      "API traffic from internal load balancer",
    );

    const vpcLinkSecurityGroup = new ec2.SecurityGroup(this, "VpcLinkSecurityGroup", {
      vpc,
      allowAllOutbound: true,
      description: "API Gateway VPC Link to internal load balancer",
    });
    loadBalancerSecurityGroup.addIngressRule(
      vpcLinkSecurityGroup,
      ec2.Port.tcp(80),
      "HTTP from API Gateway VPC Link",
    );
    const vpcLink = new apigwv2.VpcLink(this, "VpcLink", {
      vpc,
      securityGroups: [vpcLinkSecurityGroup],
      subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });
    const integration = new HttpAlbIntegration("ApiIntegration", listener, {
      vpcLink,
    });
    const httpApi = new apigwv2.HttpApi(this, "HttpApi", {
      apiName: "project-archive-sandbox",
      defaultIntegration: integration,
      createDefaultStage: true,
    });

    new CfnOutput(this, "ApiUrl", {
      value: httpApi.apiEndpoint,
      description: "HTTPS API URL; set VITE_API_PROXY_TARGET to this value",
    });
    // Recorded so the origin and cookie policy a deploy actually used can be
    // read back without decoding the task definition.
    new CfnOutput(this, "ConfiguredWebOrigin", {
      value: origins.webOrigin,
      description: "Browser origin this API accepts and sets cookies for",
    });
    new CfnOutput(this, "CookieSecure", {
      value: String(origins.cookieSecure),
      description: "Whether session cookies carry the Secure attribute",
    });
    new CfnOutput(this, "DatabaseSecretArn", {
      value: database.secret!.secretArn,
    });
    // The imported secrets, listed so a failed task start can be diagnosed from
    // the stack rather than by decoding the task definition.
    new CfnOutput(this, "RequiredSecrets", {
      value: Object.entries(REQUIRED_SECRETS)
        .map(([name, keys]) => `${name}{${keys.join(",")}}`)
        .join(" "),
      description:
        "Secrets Manager secrets this stack expects to already exist, with the " +
        "JSON keys each must hold. Run `pnpm aws:secrets:check` before deploying.",
    });
    new CfnOutput(this, "AlertDestination", {
      value: alertEmail ?? "NONE",
      description:
        "Where CloudWatch alarms are delivered. NONE means the grading-fallback " +
        "alarm fires into an unsubscribed topic.",
    });
    new CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
    });
    new CfnOutput(this, "ServiceName", {
      value: service.serviceName,
    });
  }
}
