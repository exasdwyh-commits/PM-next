type Turn = { role: string; content: string };

const DEVELOPMENT = /(?:我(?:们)?(?:想|打算|准备|计划|要)|帮我|请|开始|启动).{0,18}(?:开发|研发|做|打造|推出|孵化).{0,24}(?:产品|新品|一款|一个|饮料|食品|保健|人参|设备|软件|应用)|(?:开发|研发|打造|推出).{0,8}(?:一款|一个|新产品|新品)/;
const DECLINE = /(?:不要|不用|无需|别|暂不|先不|不想).{0,12}(?:开发|研发|启动|做|创建|推进)|只(?:想|是)?(?:聊|讨论|了解)|取消|换个话题/;
const FOLLOW_UP = /^(?:那|就|按|好|可以|继续|开始|帮我推进)|目标(?:用户|人群)|预算|价格|定价|渠道|人群|周期|定位|剂型|口味|成本|卖给|面向|主要是|希望|计划/;

/** Only a user's current instruction can activate a goal; quoted and declined goals are data. */
export function conversationProductGoal(text: string, history: Turn[] = []): string | null {
  const current = text.trim();
  if (DECLINE.test(current) || /^(?:引用|摘录|下面是|这是|例如|假设|如果别人)/.test(current)) return null;
  if (DEVELOPMENT.test(current)) return current;
  if (!FOLLOW_UP.test(current) || /(?:进度|状态|怎么样|做到哪|是什么|什么意思|如何使用|怎么用)/.test(current)) return null;
  const recent = history.slice(-6).filter(turn => turn.role.toUpperCase() === "USER");
  let anchor = -1;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (DECLINE.test(recent[i].content)) return null;
    if (DEVELOPMENT.test(recent[i].content) && !/^(?:引用|摘录|下面是|例如|假设)/.test(recent[i].content.trim())) { anchor = i; break; }
  }
  if (anchor < 0) return null;
  return [...recent.slice(anchor).map(turn => turn.content.slice(0, 2000)), current].join("\n\n");
}
