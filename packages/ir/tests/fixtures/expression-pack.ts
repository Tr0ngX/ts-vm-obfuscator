export function expressionPack() {
  const sparse = [1, , 3, ...new Set([4, 5]), , ...'67'];
  const keys = Object.keys(sparse).join('|');
  const spreadCall = String.fromCharCode(...new Set([65, 66, 67]));
  const stamp = new Date(...new Set([2020, 1, 2]));
  return `${sparse.length}:${keys}:${String(sparse[1])}:${sparse.slice(2).join(',')}:${spreadCall}:${stamp.getFullYear()}-${stamp.getMonth()}-${stamp.getDate()}`;
}
