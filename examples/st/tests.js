/** @virtualize */
export function joinSegments(parts) {
  return parts.join(":");
}

/** @virtualize */
export function foldBits(values) {
  let acc = 0x13579bdf;
  for (let i = 0; i < values.length; i++) {
    acc ^= values[i] + i;
    acc = Math.imul(acc ^ (acc >>> 3), 0x45d9f3b) >>> 0;
  }
  return acc >>> 0;
}

/** @virtualize */
export function runComplexStructures(flag) {
  const nested = [[3, 5], [8, 13]];
  const helpers = { joinSegments, foldBits };
  const summary = {
    left: nested[0][1],
    right: nested[1][0],
    flag,
    helpers,
  };

  nested[1][0] = summary.left ^ summary.right;

  if (flag > 3) {
    nested[0][0] = nested[1][0] & 15;
  } else {
    nested[0][0] = nested[1][0] | 16;
  }

  const tags = ["vm", String(nested[0][0]), String(summary.flag)];
  const payload = {
    digest: helpers.foldBits([nested[0][0], nested[0][1], nested[1][0], summary.right]),
    joined: helpers.joinSegments(tags),
  };

  return payload.joined + "#" + String(payload.digest);
}
