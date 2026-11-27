export const attributeBenchmark = 10;

export function attributeModifier(score) {
  return Math.floor((score - attributeBenchmark) / 2);
}
