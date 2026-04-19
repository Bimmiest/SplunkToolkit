export interface FieldNode {
  name: string;
  leafName: string;
  color: string;
  processor: string | null;
  isContainer: boolean;
  depth: number;
  children: FieldNode[];
}

export function buildFieldTree(
  fieldColorMap: Map<string, string>,
  containerFields: Set<string>,
  fieldProcessorMap: Map<string, string>,
): FieldNode[] {
  const roots: FieldNode[] = [];
  const nodeMap = new Map<string, FieldNode>();

  for (const name of Array.from(fieldColorMap.keys()).sort()) {
    const color = fieldColorMap.get(name)!;
    const parts = name.split('.');
    const node: FieldNode = {
      name,
      leafName: parts[parts.length - 1],
      color,
      processor: fieldProcessorMap.get(name) ?? null,
      isContainer: containerFields.has(name),
      depth: parts.length - 1,
      children: [],
    };
    nodeMap.set(name, node);

    let placed = false;
    for (let i = parts.length - 1; i > 0; i--) {
      const parent = nodeMap.get(parts.slice(0, i).join('.'));
      if (parent) { parent.children.push(node); placed = true; break; }
    }
    if (!placed) roots.push(node);
  }

  return roots;
}

export function nodeMatchesSearch(node: FieldNode, search: string): boolean {
  if (!search) return true;
  if (node.name.toLowerCase().includes(search)) return true;
  return node.children.some((c) => nodeMatchesSearch(c, search));
}
