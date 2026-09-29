import * as db from './db.js';
import renderer from './renderer.js';
import getStyles from './styles.js';
import { injectUtils } from './mermaidUtils.js';

export const diagram = {
  db,
  renderer,
  parser: { parse: db.parse },
  styles: getStyles,
  injectUtils,
};
