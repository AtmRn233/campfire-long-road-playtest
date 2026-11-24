import manifest from './audio/voices/manifest.json' with {type:'json'};

export const battleVoicePools=manifest;

export function randomVoiceIndex(length,previous=-1,random=Math.random) {
  if(length<=1) return 0;
  const exclude=previous>=0&&previous<length;
  const index=Math.floor(random()*(length-Number(exclude)));
  return exclude&&index>=previous ? index+1 : index;
}
