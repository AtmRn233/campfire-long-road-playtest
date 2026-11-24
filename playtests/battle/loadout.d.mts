export const battleItemLabels: readonly ["道具一", "道具二", "道具三", "道具四"];
export const battleItemSlots: typeof battleItemLabels["length"];
export function battleItemCount(items: readonly {qty:number}[]): number;
export function battleItemsBySlot<T extends { qty: number; slot?: number }>(items: readonly T[]): (T | undefined)[];
export const carryKgPerStrength: 3;
export function battleLoad(strength:number,equipped:number,items:number): {
  maximum:number;
  equipped:number;
  items:number;
  remaining:number;
};
