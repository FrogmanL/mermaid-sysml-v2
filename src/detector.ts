import type { ExternalDiagramDefinition } from 'mermaid';

const id = 'sysml-v2';

const detector = (txt: string): boolean => /^\s*sysml-v2\b/.test(txt);

const loader = async () => {
  const { diagram } = await import('./diagram-definition.js');
  return { id, diagram };
};

const plugin: ExternalDiagramDefinition = {
  id,
  detector,
  loader,
};

export default plugin;
