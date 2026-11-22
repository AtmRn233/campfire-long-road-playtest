export const fieldRanks = [
  {fieldSide:"enemy",row:"back"},
  {fieldSide:"enemy",row:"front"},
  {fieldSide:"player",row:"front"},
  {fieldSide:"player",row:"back"},
];

export const fieldSideOf = ({fieldSide,side}) => fieldSide ?? side;
export const rankOf = (unit) => fieldRanks.findIndex(({fieldSide,row})=>fieldSide===fieldSideOf(unit) && row===unit.row);
export const adjacent = (a,b) => Math.max(Math.abs(rankOf(a)-rankOf(b)),Math.abs(a.column-b.column)) === 1;
