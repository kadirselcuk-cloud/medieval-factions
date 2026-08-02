const integer = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

export function num(value: number): string {
  return integer.format(Math.floor(value));
}

export function signed(value: number): string {
  return `${value >= 0 ? '+' : '−'}${integer.format(Math.abs(Math.floor(value)))}`;
}
