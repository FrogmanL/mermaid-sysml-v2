import { parseSysml } from './parser/parser.js';
import type { SysmlModel } from './parser/ast.js';

let model: SysmlModel = { definitions: [], traceability: [] };
let accTitle = '';
let accDescription = '';
let diagramTitle = '';

export const parse = (text: string): void => {
  model = parseSysml(text);
};

export const getModel = (): SysmlModel => model;

export const getAccTitle = (): string => accTitle;
export const setAccTitle = (txt: string): void => {
  accTitle = txt;
};

export const getAccDescription = (): string => accDescription;
export const setAccDescription = (txt: string): void => {
  accDescription = txt;
};

export const getDiagramTitle = (): string => diagramTitle || model.packageName || '';
export const setDiagramTitle = (txt: string): void => {
  diagramTitle = txt;
};

export const clear = (): void => {
  model = { definitions: [], traceability: [] };
  accTitle = '';
  accDescription = '';
  diagramTitle = '';
};

export default {
  parse,
  getModel,
  getAccTitle,
  setAccTitle,
  getAccDescription,
  setAccDescription,
  getDiagramTitle,
  setDiagramTitle,
  clear,
};
