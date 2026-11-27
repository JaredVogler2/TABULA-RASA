import { InstancedMesh, Matrix4, Vector3 } from "three";
import { expect, it } from "vitest";
import { ACTION_CODES, AF, AGENT_STRIDE, TOOL_BIT, type ViewFrame } from "@/worker/protocol";
import { buildCitizens } from "./citizens";
import type { HeightField } from "./heightfield";

it("packs only visible tools and loads and clears both limbs when a citizen dies", () => {
  const field = { w: 12, h: 12, standAt: () => 0 } as unknown as HeightField;
  const citizens = buildCitizens(field, 2, "high");
  try {
    citizens.setRoster([0, 1].map((id) => ({ id, name: String(id), traits: [], phys: [50] })));
    const agents = new Float32Array(2 * AGENT_STRIDE);
    const frame = { agentCount: 2, agents, tps: 1 } as ViewFrame;
    for (const offset of [0, AGENT_STRIDE]) {
      agents[offset + AF.alive] = 1;
      agents[offset + AF.partner] = -1;
      agents[offset + AF.target] = -1;
    }
    agents[AGENT_STRIDE + AF.x] = 4;
    agents[AGENT_STRIDE + AF.tools] = TOOL_BIT.axe;
    agents[AGENT_STRIDE + AF.carry] = 4; // wood
    agents[AGENT_STRIDE + AF.load] = 1;

    const mesh = (name: string) => citizens.objects.find(
      (part): part is InstancedMesh => part instanceof InstancedMesh && part.name === `citizen-${name}`,
    )!;
    const axe = mesh("axe");
    const logs = mesh("load-logs");
    const head = mesh("head");
    const detailed = head.geometry;
    citizens.setDistance(90);
    expect(head.geometry.getAttribute("position").count).toBeLessThan(detailed.getAttribute("position").count);
    citizens.setDistance(18);
    expect(head.geometry).toBe(detailed);
    const matrix = new Matrix4();

    citizens.update(frame, 0, 1, 0);
    expect(axe.count).toBe(1);
    expect(logs.count).toBe(1);
    axe.getMatrixAt(0, matrix);
    const back = new Vector3().setFromMatrixPosition(matrix);
    expect(back.x).toBeGreaterThan(-2.5); // The packed slot belongs to the second citizen.

    agents[AGENT_STRIDE + AF.action] = ACTION_CODES.indexOf("gather_wood");
    citizens.update(frame, 0, 1, 0);
    expect(logs.count).toBe(0);
    expect(axe.count).toBe(1);
    axe.getMatrixAt(0, matrix);
    expect(new Vector3().setFromMatrixPosition(matrix).distanceTo(back)).toBeGreaterThan(0.1);

    agents[AGENT_STRIDE + AF.alive] = 0;
    citizens.update(frame, 0, 1, 0);
    expect(axe.count).toBe(0);
    expect(citizens.positionOf(1, new Vector3())).toBe(false);
    for (const part of ["upper-arm", "forearm", "thigh", "shin"]) {
      const limb = mesh(part);
      limb.getMatrixAt(1, matrix);
      expect(matrix.determinant()).toBeGreaterThan(0);
      for (const index of [2, 3]) {
        limb.getMatrixAt(index, matrix);
        expect(matrix.determinant()).toBe(0);
      }
    }
  } finally {
    citizens.dispose();
  }
});
