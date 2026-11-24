export const battleItemLabels = ["道具一","道具二","道具三","道具四"];
export const battleItemSlots = battleItemLabels.length;
export const battleItemCount = (items) => items.reduce((count,item)=>count+item.qty,0);

export function battleItemsBySlot(items) {
  const slots = Array(battleItemSlots).fill(undefined);
  const loose = [];
  for (const item of items) {
    if (item.qty === 1 && Number.isInteger(item.slot) && item.slot >= 0 && item.slot < battleItemSlots && !slots[item.slot]) {
      slots[item.slot] = item;
    } else {
      for (let i = 0; i < item.qty && loose.length < battleItemSlots; i++) loose.push(item);
    }
  }
  return slots.map(item => item ?? loose.shift());
}

export const carryKgPerStrength = 3;

export function battleLoad(strength,equipped,items) {
  const maximum = strength*carryKgPerStrength;
  const remaining = Math.round((maximum-equipped-items)*1e6)/1e6;
  return {maximum,equipped,items,remaining:remaining === 0 ? 0 : remaining};
}
