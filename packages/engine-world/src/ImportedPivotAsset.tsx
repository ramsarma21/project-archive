import {
  Component,
  Suspense,
  useMemo,
  type ReactNode,
} from "react";
import * as THREE from "three";
import { createPortal } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import { clone as skeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";

export interface ImportedNodeAttachment {
  nodeName: string;
  content: ReactNode;
}

class ImportedPivotBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {}
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function ImportedPivotAssetInner(props: {
  glbKey: string;
  size: [number, number, number];
  pivotName?: string;
  attachments: readonly ImportedNodeAttachment[];
  castShadow: boolean;
}) {
  const gltf = useGLTF(`/world/props/${props.glbKey}.glb`);
  const prepared = useMemo(() => {
    const root = skeletonClone(gltf.scene);
    root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = props.castShadow;
      mesh.receiveShadow = true;
    });
    const source = new THREE.Box3().setFromObject(root);
    const sourceSize = source.getSize(new THREE.Vector3());
    const scale = Math.min(
      props.size[0] / Math.max(sourceSize.x, 0.001),
      props.size[1] / Math.max(sourceSize.y, 0.001),
      props.size[2] / Math.max(sourceSize.z, 0.001),
    );
    root.scale.setScalar(scale);
    const fitted = new THREE.Box3().setFromObject(root);
    const center = fitted.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -fitted.min.y, -center.z);
    root.updateMatrixWorld(true);
    if (props.pivotName) {
      const pivot = root.getObjectByName(props.pivotName);
      if (!pivot) {
        throw new Error(
          `M4 imported asset ${props.glbKey} is missing pivot ${props.pivotName}`,
        );
      }
      const pivotAt = pivot.getWorldPosition(new THREE.Vector3());
      root.position.sub(pivotAt);
      root.updateMatrixWorld(true);
    }
    const attachmentNodes = props.attachments.map(({ nodeName }) => {
      const node = root.getObjectByName(nodeName);
      if (!node) {
        throw new Error(
          `M4 imported asset ${props.glbKey} is missing node ${nodeName}`,
        );
      }
      return node;
    });
    return { root, attachmentNodes };
  }, [
    gltf.scene,
    props.attachments,
    props.castShadow,
    props.glbKey,
    props.pivotName,
    props.size,
  ]);

  return (
    <>
      <primitive object={prepared.root} />
      {props.attachments.map((attachment, index) =>
        createPortal(
          attachment.content,
          prepared.attachmentNodes[index]!,
        ),
      )}
    </>
  );
}

/**
 * Imported physical asset normalized to a target box. A named empty can become
 * the transform origin, and React content can mount directly on verified named
 * nodes (placard/banner faces, light points, actor stands).
 */
export function ImportedPivotAsset(props: {
  glbKey: string;
  size: [number, number, number];
  pivotName?: string;
  attachments?: readonly ImportedNodeAttachment[];
  castShadow?: boolean;
}) {
  return (
    <ImportedPivotBoundary>
      <Suspense fallback={null}>
        <ImportedPivotAssetInner
          glbKey={props.glbKey}
          size={props.size}
          pivotName={props.pivotName}
          attachments={props.attachments ?? []}
          castShadow={props.castShadow ?? true}
        />
      </Suspense>
    </ImportedPivotBoundary>
  );
}
