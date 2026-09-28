/* eslint-disable @typescript-eslint/no-explicit-any */
const getStyles = (options: any): string => `
.sysml-v2 .node rect {
  fill: ${options.mainBkg ?? options.primaryColor ?? '#eee'};
  stroke: ${options.nodeBorder ?? options.primaryBorderColor ?? '#999'};
  stroke-width: 1px;
}
.sysml-v2 .node line.divider {
  stroke: ${options.nodeBorder ?? options.primaryBorderColor ?? '#999'};
  stroke-width: 1px;
}
.sysml-v2 .node text {
  fill: ${options.textColor ?? options.primaryTextColor ?? '#333'};
  font-family: ${options.fontFamily ?? 'inherit'};
}
.sysml-v2 .node .title {
  font-weight: 700;
}
.sysml-v2 .node .stereotype {
  font-style: italic;
}
.sysml-v2 .node .compartment-label {
  font-style: italic;
  fill: ${options.secondaryTextColor ?? options.textColor ?? '#666'};
}
.sysml-v2 .child rect {
  fill: ${options.tertiaryColor ?? options.mainBkg ?? '#eee'};
}
.sysml-v2 rect.port {
  fill: ${options.nodeBorder ?? options.primaryBorderColor ?? '#999'};
  stroke: ${options.nodeBorder ?? options.primaryBorderColor ?? '#999'};
}
.sysml-v2 path.connector {
  stroke: ${options.lineColor ?? '#999'};
  stroke-width: 1.5px;
  fill: none;
}
.sysml-v2 polygon.connector-arrow {
  fill: ${options.lineColor ?? '#999'};
}
.sysml-v2 circle.connector-junction {
  fill: ${options.lineColor ?? '#999'};
}
.sysml-v2 text.connector-label {
  fill: ${options.textColor ?? options.primaryTextColor ?? '#333'};
}
.sysml-v2 line.tree-line {
  stroke: ${options.nodeBorder ?? options.primaryBorderColor ?? '#999'};
  stroke-width: 1px;
}
.sysml-v2 polygon.tree-diamond {
  fill: ${options.nodeBorder ?? options.primaryBorderColor ?? '#999'};
}
.sysml-v2 line.specialization-line {
  stroke: ${options.nodeBorder ?? options.primaryBorderColor ?? '#999'};
  stroke-width: 1px;
}
.sysml-v2 polygon.specialization-arrow {
  fill: ${options.mainBkg ?? options.primaryColor ?? '#eee'};
  stroke: ${options.nodeBorder ?? options.primaryBorderColor ?? '#999'};
  stroke-width: 1px;
}
`;

export default getStyles;
