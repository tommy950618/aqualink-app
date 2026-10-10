// JSON with small objects/arrays kept on one line (readable configs, stable diffs).
export function formatJson(v, ind = '') {
  const one = JSON.stringify(v);
  if (v === null || typeof v !== 'object' || one.length + ind.length <= 110) return one.replace(/":/g, '": ').replace(/,"/g, ', "').replace(/,(?=[\d\[{-])/g, ', ');
  const next = ind + '  ';
  if (Array.isArray(v)) return '[\n' + v.map((x) => next + formatJson(x, next)).join(',\n') + '\n' + ind + ']';
  return '{\n' + Object.entries(v).map(([k, x]) => next + JSON.stringify(k) + ': ' + formatJson(x, next)).join(',\n') + '\n' + ind + '}';
}
