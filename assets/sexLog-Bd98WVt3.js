import{Wi as e,ni as t}from"./campaignBirthplaces-BPatdm4K.js";import{Xf as n,cp as r,ga as i,sp as a,tp as o}from"./teamSupplies-Dij-P1DJ.js";var s=6e3;function c(e){let t=e.trim();if(t.length<=s)return t;let n=s/2;return`${t.slice(0,n)}\n……（中略）……\n${t.slice(-3e3)}`}function l(n,r){if(r===`pc`){let r=n.party.find(e=>e.isPlayer);return`${r.name}（id: pc，主角${r.gender?`，${t(r.gender)}`:``}，${e(r.race)}）`}let a=n.party.find(e=>e.id===r),o=i(n,r),s=a?.gender??o?.gender;return`${a?.name??o?.name??r}（id: ${r}${s?`，${t(s)}`:``}${a?`，隊友`:``}，${e(a?.race??o?.race??`human`)}）`}function u(e){return[e.outcome.summary?`摘要：${e.outcome.summary}`:``,e.narration?.adult_scene?`親密場景：${e.narration.adult_scene}`:``,e.narration?.intimate_note?`正文寫到的親密場景：${e.narration.intimate_note}`:``,e.narration?.player_intent?`主角想做的事：${e.narration.player_intent}`:``,...(e.timeline??[]).slice(-12).map(e=>`- ${e.actor}：${e.action}${e.target?` → ${e.target}`:``}`),e.others?.length?`在場的其他人：${e.others.map(e=>`${e.name}（${e.id}）`).join(`、`)}`:``].filter(Boolean).join(`
`)}function d(e,t,i){let s=n(e,t);return s.length?{prompt:{system:`你是奇幻 RPG《篝火与长路》（成人向）的記錄員。下面是一段剛發生的親密場景（報告與寫好的經過）以及在場角色目前的性經歷。請讀完之後，記下這段經過裡，名單上的每個人實際做了什麼。不寫正文、不評論，只輸出 JSON。

規則：
1. 只記名單上的人（id 照名單寫）；沒有發生的事不要記。只是挑逗、愛撫、親吻、看著、被脫衣而沒有性交、性侍奉或自慰的人不要列出。
2. sex：這次「性交」（插入）的次數；service：這次「性侍奉」（口交、手交、乳交、足交……替對方服務）的次數；solo：這次「自慰」（自己弄到高潮或明顯在自慰）的次數。三項都沒有就不要列出這個人。次數看不出來時填 1。只有自慰時 with 留空。
3. with：這次的對象（每人一筆）：名單上或在場有 id 的人填 id 與名字；路人、客人、怪物、一群人照經過裡的稱呼寫名字（例如「酒館的客人」「哥布林」），不填 id，但要填 gender（female 女性、male 男性、futa 扶她、femboy 偽娘、ts；看不出來或一群人男女都有時填 unknown）。每一筆的 sex／service 寫這個人自己和這個對象性交、替這個對象性侍奉的次數（沒有就填 0），例如接了三位客人、只替其中一位口交時，只有那一位的 service 是 1。
4. 被強迫、被侵犯、不得不從（主人的命令、戰敗後的遭遇……）時 forced 填 true。
5. summary：這次的經過，一句話（≤ 60 字）。
6. first_time：只在這個人「目前是處子」而這次第一次性交時填：一句話記下初體驗（≤ 60 字）。
7. favorite：只在經過明顯表現出這個人最喜歡的對象改變時填（名字）；notes：只在出現新的性癖或偏好時填：更新後的一句話（≤ 60 字），會整個取代原本的。
8. 只記錄成年的角色。
9. parts 和 roles 為這位角色在這次與對象的經歷中明確記載的部位與主被動。parts 只用 ${a.join(`、`)}，roles 只用 ${r.join(`、`)}，可填多項。solo_parts 只填這次自慰中明確記載的部位，與 parts 分開。資訊未交代時對應陣列留空。
只輸出 JSON：{"records":[{"id":"…","sex":0,"service":0,"solo":0,"with":[{"name":"…","id":"…","gender":"…","sex":0,"service":0}],"parts":[],"roles":[],"solo_parts":[],"forced":false,"summary":"…","first_time":"","favorite":"","notes":""}]}；沒有可以記的就輸出 {"records":[]}`,user:[`<people>\n${s.map(t=>`- ${l(e,t)}\n  目前：${o(e,t)}`).join(`
`)}\n</people>`,`<report>\n第 ${t.time.end.day} 天\n${u(t)}\n</report>`,i.trim()?`<narrative>\n${c(i)}\n</narrative>`:`（這則日誌沒有寫出經過，照報告判斷）`].join(`

`)},candidates:s}:null}export{d as buildSexLogPrompt};