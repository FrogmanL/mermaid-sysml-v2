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
`;

export default getStyles;
