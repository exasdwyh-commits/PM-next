/*
 * 浏览器内页采集探针（纯 JS；由 verify-ui-walkthrough.ts 读成字符串后注入页面执行）
 *
 * ⚠️ 为什么单独一个文件、且必须以「字符串」形式交给 page.evaluate：
 *   tsx 用 esbuild（keepNames:true）转译 .ts，会给**具名函数字面量/函数声明**注入
 *   `__name(fn,"name")`（匿名回调不受影响）。Playwright 在页面里执行的是 fn.toString() 的结果，
 *   而页面上下文里没有 __name → `ReferenceError: __name is not defined` → 探针被 try/catch
 *   吞掉后**静默回落成默认值**（本走查历史上因此长期报「零溢出 / 零小目标」，是假绿）。
 *   把探针放进这个纯 JS 文件、以字符串注入，就绕开了转译陷阱（字符串内容不会被 esbuild 改写）。
 *
 * 入参 arg：{ clickMin: number }
 * 返回：见文件末尾 return（全部为可 JSON 序列化的实测值）。
 */
function pageProbe(arg) {
  var clickMin = arg.clickMin;
  var de = document.documentElement;
  var scrollWidth = de.scrollWidth;
  var clientWidth = de.clientWidth;
  var innerWidth = window.innerWidth;

  // 生成一个短 CSS 选择器（tag + 最多两个 class + nth-of-type），用于定位违规元素
  function cssPath(el) {
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node !== document.body && depth < 4) {
      var sel = node.tagName.toLowerCase();
      var cls = (node.getAttribute("class") || "").trim().split(/\s+/).filter(Boolean);
      if (cls.length) sel += "." + cls.slice(0, 2).join(".");
      if (node.parentElement) {
        var siblings = Array.prototype.slice.call(node.parentElement.children);
        var sameTag = siblings.filter(function (c) {
          return c.tagName === node.tagName;
        });
        if (sameTag.length > 1) sel += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      parts.unshift(sel);
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(" > ") || el.tagName.toLowerCase();
  }

  // 1) 横向溢出：先看 documentElement，再定位越出右缘的具体元素
  var offenders = [];
  if (scrollWidth > clientWidth + 1) {
    Array.prototype.slice.call(document.querySelectorAll("body *")).forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      if (r.right > clientWidth + 1) {
        offenders.push({
          sel: cssPath(el),
          right: Math.round(r.right),
          width: Math.round(r.width),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        });
      }
    });
    offenders.sort(function (a, b) {
      return b.right - a.right;
    });
  }

  // 2) 列可见性：.project-row / .project-table-head 每个 nth-child 的 display 与实测宽
  function scan(root, selector) {
    if (!root) return null;
    var cs = getComputedStyle(root);
    var cells = Array.prototype.slice.call(root.children).map(function (c, i) {
      var ccs = getComputedStyle(c);
      var r = c.getBoundingClientRect();
      return {
        nth: i + 1,
        tag: c.tagName.toLowerCase(),
        display: ccs.display,
        width: Math.round(r.width),
        text: (c.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24),
      };
    });
    return { selector: selector, gridTemplateColumns: cs.gridTemplateColumns, cells: cells };
  }
  var columns = {
    projectRow: scan(document.querySelector(".project-row"), ".project-row"),
    projectHead: scan(document.querySelector(".project-table-head"), ".project-table-head"),
  };

  // 3) 点击区 < clickMin×clickMin（排除不可见 / 不可点 / hidden）
  var clickViolations = [];
  var clickablesExamined = 0;
  Array.prototype.slice
    .call(document.querySelectorAll('a, button, [role="button"], input[type="checkbox"], select'))
    .forEach(function (el) {
      var cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") return;
      if (el.hasAttribute("hidden") || el.closest("[hidden]")) return;
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      clickablesExamined += 1;
      if (r.width < clickMin || r.height < clickMin) {
        var raw =
          el.getAttribute("aria-label") || (el.textContent || "").trim() || el.getAttribute("href") || el.tagName;
        clickViolations.push({
          sel: cssPath(el),
          label: String(raw).replace(/\s+/g, " ").slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
    });
  clickViolations.sort(function (a, b) {
    return a.h - b.h || a.w - b.w;
  });

  // 4) 文本泄漏 / 英文枚举 / 断图
  // ⚠️ 只统计【可见文本】。Next 会把 RSC flight 数据以
  //    <script>self.__next_f.push([1,"…"])</script> 内联进 HTML；<script> 无子元素、
  //    textContent 非空，旧逻辑（仅判 children.length===0）会把它当"叶子文本"，
  //    于是把 payload 里的 "undefined" / "IN_REVIEW" / "PENDING" 等误报成
  //    "页面可见文案泄漏"（红基线里的假红根因）。这里加双重过滤：
  //    ① 排除 script/style/template/noscript 等非渲染标签；
  //    ② 只保留真正可见（未被 display:none / visibility:hidden / [hidden] 隐藏）的元素。
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEMPLATE: 1, NOSCRIPT: 1, TITLE: 1, META: 1, LINK: 1, HEAD: 1 };
  function isVisible(el) {
    if (el.closest("[hidden]")) return false;
    if (typeof el.checkVisibility === "function") {
      try {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      } catch (e) {
        try {
          return el.checkVisibility();
        } catch (e2) {
          /* 落到下面的手工判定 */
        }
      }
    }
    var cs = getComputedStyle(el);
    return cs.display !== "none" && cs.visibility !== "hidden" && cs.opacity !== "0";
  }
  var leaves = [];
  Array.prototype.slice.call(document.querySelectorAll("body *")).forEach(function (el) {
    if (el.children.length !== 0) return;
    if (SKIP_TAGS[el.tagName]) return;
    if (!(el.textContent || "").trim()) return;
    if (!isVisible(el)) return;
    leaves.push(el);
  });

  var leakRe = /(?:^|[^\w])(undefined|NaN|\[object Object\])(?:[^\w]|$)/;
  var leakSamples = [];
  for (var i = 0; i < leaves.length; i += 1) {
    var t = (leaves[i].textContent || "").trim();
    if (leakRe.test(t)) leakSamples.push(t.slice(0, 90));
    if (leakSamples.length >= 8) break;
  }

  var enumRe =
    /\b(APPROVED|REJECTED|PENDING|DRAFT|IN_REVIEW|UNDER_REVIEW|LEADER|MEMBER|ORG_ADMIN|OWNER|EDITOR|VIEWER|BLOCKED|IN_PROGRESS|TODO|DONE|HIGH|MEDIUM|LOW|CRITICAL)\b/g;
  var enumHits = {};
  for (var j = 0; j < leaves.length; j += 1) {
    var m = (leaves[j].textContent || "").match(enumRe);
    if (m)
      m.forEach(function (x) {
        enumHits[x] = true;
      });
  }

  // 4b) G3 · 无来源评分 / 百分比（并集口径；2026-09-18 收紧到整数）
  //     规则 = 关键词锚定 `(评分|得分|分数|打分)[:：]?<num>(分|%)?`  ∪  裸小数+单位 `\d+\.\d+\s*(分|%)`。
  //     为什么关键词锚定不误报：真实页面可见文案里「评分/得分/分数/打分」后紧跟数字的形态**不存在**——
  //     「评分」只出现在 `data-label` 伪元素（不入 textContent），且探针只取**无子节点的可见叶子**、
  //     只取可见文本；其余命中全在注释里（注释在渲染前已被剥离）。故该模式真实命中 0。
  //     旧口径只抓 `\d+\.\d+`（小数），**整数 `88 分` 可逃**——此并集把整数也纳入。
  var unsourcedScoreSamples = [];
  var unsourcedScoreRe =
    /(?:评分|得分|分数|打分)\s*[:：]?\s*\d+(?:\.\d+)?\s*(?:分|%)?|\d+\.\d+\s*(?:分|%)/g;
  for (var k = 0; k < leaves.length; k += 1) {
    var dm = (leaves[k].textContent || "").match(unsourcedScoreRe);
    if (dm) for (var n = 0; n < dm.length; n += 1) unsourcedScoreSamples.push(dm[n].replace(/\s+/g, " ").trim());
  }

  // 4c) G6 · 分母（被检元素数）：R2 点击区 / R3 文本块 / 断图，供上游断言「分母 > 0」防假绿
  var imgNodes = Array.prototype.slice.call(document.querySelectorAll("img"));
  var imagesExamined = imgNodes.length;
  var brokenImages = [];
  imgNodes.forEach(function (img) {
    if (img.complete && img.naturalWidth === 0) brokenImages.push((img.getAttribute("src") || "").slice(0, 90));
  });

  return {
    scrollWidth: scrollWidth,
    clientWidth: clientWidth,
    innerWidth: innerWidth,
    overflow: Math.max(0, scrollWidth - clientWidth),
    offenders: offenders.slice(0, 10),
    columns: columns,
    clickViolations: clickViolations.slice(0, 60),
    leakSamples: Array.from(new Set(leakSamples)).slice(0, 6),
    rawEnumSamples: Object.keys(enumHits).slice(0, 12),
    unsourcedScoreSamples: Array.from(new Set(unsourcedScoreSamples)).slice(0, 12),
    brokenImages: Array.from(new Set(brokenImages)).slice(0, 6),
    counts: {
      clickables: clickablesExamined,
      textLeaves: leaves.length,
      images: imagesExamined,
    },
  };
}
