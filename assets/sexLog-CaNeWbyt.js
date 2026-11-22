import{$g as e,Ey as t,Jg as n,Yw as r,gw as i}from"./security--Rn47C9K.js";var a=6e3;function o(e){let t=e.trim();if(t.length<=a)return t;let n=a/2;return`${t.slice(0,n)}\n……（中略）……\n${t.slice(-3e3)}`}function s(e,n){if(n===`pc`){let t=e.party.find(e=>e.isPlayer);return`${t.name}（id: pc，主角${t.gender?`，${i(t.gender)}`:``}，${r(t.race)}）`}let a=e.party.find(e=>e.id===n),o=t(e,n),s=a?.gender??o?.gender;return`${a?.name??o?.name??n}（id: ${n}${s?`，${i(s)}`:``}${a?`，隊友`:``}，${r(a?.race??o?.race??`human`)}）`}function c(e){return[e.outcome.summary?`摘要：${e.outcome.summary}`:``,e.narration?.adult_scene?`親密場景：${e.narration.adult_scene}`:``,e.narration?.intimate_note?`正文寫到的親密場景：${e.narration.intimate_note}`:``,e.narration?.player_intent?`主角想做的事：${e.narration.player_intent}`:``,...(e.timeline??[]).slice(-12).map(e=>`- ${e.actor}：${e.action}${e.target?` → ${e.target}`:``}`),e.others?.length?`在場的其他人：${e.others.map(e=>`${e.name}（${e.id}）`).join(`、`)}`:``].filter(Boolean).join(`
`)}function l(t,r,i){let a=n(t,r);return a.length?{prompt:{system:`你是奇幻 RPG《篝火与长路》（成人向）的記錄員。下面是一段剛發生的親密場景（報告與寫好的經過）以及在場角色目前的性經歷。請讀完之後，記下這段經過裡，名單上的每個人實際做了什麼。不寫正文、不評論，只輸出 JSON。

規則：
1. 只記名單上的人（id 照名單寫）；沒有發生的事不要記。只是挑逗、愛撫、親吻、看著、被脫衣而沒有性交、性侍奉或自慰的人不要列出。
2. sex：這次「性交」（插入）的次數；service：這次「性侍奉」（口交、手交、乳交、足交……替對方服務）的次數；solo：這次「自慰」（自己弄到高潮或明顯在自慰）的次數。三項都沒有就不要列出這個人。次數看不出來時填 1。只有自慰時 with 留空。
3. with：這次的對象（每人一筆）：名單上或在場有 id 的人填 id 與名字；路人、客人、怪物、一群人照經過裡的稱呼寫名字（例如「酒館的客人」「哥布林」），不填 id，但要填 gender（female 女性、male 男性、futa 扶她、femboy 偽娘、ts；看不出來或一群人男女都有時填 unknown）。每一筆的 sex／service 寫這個人自己和這個對象性交、替這個對象性侍奉的次數（沒有就填 0），例如接了三位客人、只替其中一位口交時，只有那一位的 service 是 1。
4. 被強迫、被侵犯、不得不從（主人的命令、戰敗後的遭遇……）時 forced 填 true。
5. summary：這次的經過，一句話（≤ 60 字）。
6. first_time：只在這個人「目前是處子」而這次第一次性交時填：一句話記下初體驗（≤ 60 字）。
7. favorite：只在經過明顯表現出這個人最喜歡的對象改變時填（名字）；notes：只在出現新的性癖或偏好時填：更新後的一句話（≤ 60 字），會整個取代原本的。
8. 只記錄成年的角色。
只輸出 JSON：{"records":[{"id":"…","sex":0,"service":0,"solo":0,"with":[{"name":"…","id":"…","gender":"…","sex":0,"service":0}],"forced":false,"summary":"…","first_time":"","favorite":"","notes":""}]}；沒有可以記的就輸出 {"records":[]}`,user:[`<people>\n${a.map(n=>`- ${s(t,n)}\n  目前：${e(t,n)}`).join(`
`)}\n</people>`,`<report>\n第 ${r.time.end.day} 天\n${c(r)}\n</report>`,i.trim()?`<narrative>\n${o(i)}\n</narrative>`:`（這則日誌沒有寫出經過，照報告判斷）`].join(`

`)},candidates:a}:null}export{l as buildSexLogPrompt};