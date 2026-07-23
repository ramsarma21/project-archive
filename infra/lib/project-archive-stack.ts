import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_apigatewayv2 as apigwv2,
  aws_cloudwatch as cloudwatch,
  aws_ec2 as ec2,
  aws_ecr_assets as ecrassets,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_logs as logs,
  aws_rds as rds,
  aws_secretsmanager as secretsmanager,
} from "aws-cdk-lib";
import { HttpAlbIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import type { Construct } from "constructs";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");

export class ProjectArchiveStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    if (this.account !== "056956104102") {
      throw new Error(`Refusing to deploy to non-sandbox account ${this.account}`);
    }

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
      "project-archive/google-oauth",
    );
    const gradingSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      "FormativeGradingSecret",
      "project-archive/formative-grading",
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
        WEB_ORIGIN: "http://localhost:5173",
        GOOGLE_REDIRECT_URI: "http://localhost:5173/v1/auth/google/callback",
        COOKIE_SECURE: "false",
        DB_HOST: database.dbInstanceEndpointAddress,
        DB_PORT: database.dbInstanceEndpointPort,
        DB_NAME: "project_archive",
        DB_SSL: "true",
        DB_SSL_REJECT_UNAUTHORIZED: "true",
        DB_POOL_MAX: "10",
        GRADING_ENABLED: "false",
        TRUEFOUNDRY_GRADING_BASE_URL:
          "https://tfy.promptlens.trilogy.com/v1",
        TRUEFOUNDRY_GRADING_MODEL:
          "aws-bedrock/us.amazon.nova-micro-v1-0",
        TRUEFOUNDRY_GRADING_STRUCTURED_OUTPUT: "true",
        TRUEFOUNDRY_GRADING_TIMEOUT_MS: "5500",
        GRADING_ENCRYPTION_KEY_VERSION: "v1",
      },
      secrets: {
        DB_USER: ecs.Secret.fromSecretsManager(database.secret!, "username"),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(database.secret!, "password"),
        GOOGLE_CLIENT_ID: ecs.Secret.fromSecretsManager(googleOAuthSecret, "clientId"),
        GOOGLE_CLIENT_SECRET: ecs.Secret.fromSecretsManager(googleOAuthSecret, "clientSecret"),
        TRUEFOUNDRY_GRADING_API_KEY: ecs.Secret.fromSecretsManager(
          gradingSecret,
          "apiKey",
        ),
        GRADING_ENCRYPTION_KEY_BASE64: ecs.Secret.fromSecretsManager(
          gradingSecret,
          "encryptionKeyBase64",
        ),
        CSRF_SECRET: ecs.Secret.fromSecretsManager(
          gradingSecret,
          "csrfSecret",
        ),
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
    new cloudwatch.Alarm(this, "ApiCpuHigh", {
      metric: service.metricCpuUtilization({ period: Duration.minutes(5) }),
      threshold: 85,
      evaluationPeriods: 3,
      datapointsToAlarm: 3,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    new cloudwatch.Alarm(this, "DatabaseFreeStorageLow", {
      metric: database.metricFreeStorageSpace({ period: Duration.minutes(5) }),
      threshold: 2 * 1024 * 1024 * 1024,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

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
    new CfnOutput(this, "DatabaseSecretArn", {
      value: database.secret!.secretArn,
    });
    new CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
    });
    new CfnOutput(this, "ServiceName", {
      value: service.serviceName,
    });
  }
}
