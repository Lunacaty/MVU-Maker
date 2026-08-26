<script setup lang="ts">
/* eslint-disable no-useless-escape */
import { ref, watch, onBeforeUnmount } from 'vue'

/**
 * 沙盒 iframe：注入 mock 酒馆全局，渲染完整 HTML 文档。
 * props.mockData: 初始 stat_data 对象（可编辑后更新触发重渲染）
 */
const props = defineProps<{
  html: string
  mockData: Record<string, unknown>
}>()
const emit = defineEmits<{
  (e: 'change', statData: Record<string, unknown>): void
}>()

const version = ref(0)

function mockGlobalsScript(initialData: string): string {
  return `
<script>
(function(){
  var __mvu = { stat_data: ${initialData} };
  var __listeners = [];
  var __changed = false;

  // 最小 lodash-like（含状态栏/创建卡片常用函数）
  var _ = {
    get: function(o, p, d) {
      var parts = String(p).split('.');
      var cur = o;
      for (var i = 0; i < parts.length; i++) {
        if (cur == null) return d;
        cur = cur[parts[i]];
      }
      return cur === undefined ? d : cur;
    },
    set: function(o, p, v) {
      var parts = String(p).split('.');
      var cur = o;
      for (var i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = v;
      return o;
    },
    unset: function(o, p) {
      var parts = String(p).split('.');
      var cur = o;
      for (var i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
      delete cur[parts[parts.length - 1]];
      return o;
    },
    update: function(o, p, fn) {
      var parts = String(p).split('.');
      var cur = o;
      for (var i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      var key = parts[parts.length - 1];
      cur[key] = fn(cur[key]);
      return o;
    },
    clamp: function(v, min, max) { return Math.min(Math.max(v, min), max); },
    keys: Object.keys,
    values: function(o) { return o ? Object.keys(o).map(function(k){return o[k];}) : []; },
    toPairs: function(o) { return o ? Object.keys(o).map(function(k){ return [k, o[k]]; }) : []; },
    fromPairs: function(arr) { var r = {}; (arr||[]).forEach(function(p){ r[p[0]] = p[1]; }); return r; },
    pickBy: function(o, fn) {
      var r = {}; if (!o) return r;
      Object.keys(o).forEach(function(k){ if (fn(o[k])) r[k]=o[k]; });
      return r;
    },
    map: function(c, fn) {
      if (Array.isArray(c)) return c.map(fn);
      var r = []; if (!c) return r;
      Object.keys(c).forEach(function(k){ r.push(fn(c[k], k)); });
      return r;
    },
    filter: function(arr, fn) { return (arr||[]).filter(fn); },
    find: function(arr, fn) { return (arr||[]).find(fn); },
    reduce: function(arr, fn, init) { return (arr||[]).reduce(fn, init); },
    each: function(c, fn) {
      if (Array.isArray(c)) { c.forEach(function(v,i){ fn(v,i); }); }
      else if (c) { Object.keys(c).forEach(function(k){ fn(c[k], k); }); }
      return c;
    },
    forEach: function(c, fn) { return _.each(c, fn); },
    has: function(o, p) { return _.get(o, p, '__missing__') !== '__missing__'; },
    size: function(o) { return o ? Object.keys(o).length : 0; },
    isEmpty: function(o) { return o == null || Object.keys(o).length === 0; },
    isArray: Array.isArray,
    isObject: function(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); },
    includes: function(c, v) { return (Array.isArray(c) ? c.indexOf(v) : String(c).indexOf(v)) !== -1; },
    assign: function(t) { for (var i=1;i<arguments.length;i++){ var s=arguments[i]; if(s) for (var k in s) t[k]=s[k]; } return t; },
    extend: function(t) { return _.assign.apply(null, [t].concat(Array.prototype.slice.call(arguments,1))); },
    cloneDeep: function(o) { return JSON.parse(JSON.stringify(o)); }
  };
  window._ = _;

  // mini-jQuery：支持 $(fn) ready、$('selector')、$('<tag>')、$(element)
  function jq(sel) {
    if (typeof sel === 'function') {
      var run = function(){ sel(); };
      if (document.readyState !== 'loading') setTimeout(run, 0);
      else document.addEventListener('DOMContentLoaded', run);
      return;
    }
    var nodes = [];
    if (typeof sel === 'string') {
      var t = sel.trim();
      if (/^<[a-z][^>]*>$/i.test(t)) {
        var m = t.match(/^<([a-z][a-z0-9]*)/i);
        nodes.push(document.createElement(m ? m[1] : 'div'));
      } else {
        nodes = Array.prototype.slice.call(document.querySelectorAll(sel));
      }
    } else if (sel && sel.nodeType) {
      nodes = [sel];
    } else if (sel && typeof sel.length === 'number') {
      nodes = Array.prototype.slice.call(sel);
    }
    function mk(els) {
      var api = {
        isJq: true,
        length: els.length,
        each: function(fn) { els.forEach(function(n, i){ fn.call(n, i, n); }); return api; },
        text: function(v) {
          if (v === undefined) return els.map(function(n){ return n.textContent; }).join('');
          els.forEach(function(n){ n.textContent = v; });
          return api;
        },
        html: function(v) {
          if (v === undefined) return els.length ? els[0].innerHTML : '';
          els.forEach(function(n){ n.innerHTML = v; });
          return api;
        },
        val: function(v) {
          if (v === undefined) return els.length ? els[0].value : undefined;
          els.forEach(function(n){ n.value = v; });
          return api;
        },
        css: function(prop, val) {
          if (typeof prop === 'object') {
            els.forEach(function(n){ for (var k in prop) n.style[k] = prop[k]; });
            return api;
          }
          if (val === undefined) return els.length ? getComputedStyle(els[0])[prop] : undefined;
          els.forEach(function(n){ n.style[prop] = val; });
          return api;
        },
        attr: function(k, v) {
          if (v === undefined) return els.length ? els[0].getAttribute(k) : undefined;
          els.forEach(function(n){ n.setAttribute(k, v); });
          return api;
        },
        data: function(k, v) {
          if (v === undefined) return els.length ? els[0].dataset[k] : undefined;
          els.forEach(function(n){ n.dataset[k] = v; });
          return api;
        },
        addClass: function(c) {
          var t = String(c).split(/\\s+/).filter(Boolean);
          els.forEach(function(n){ for (var i = 0; i < t.length; i++) n.classList.add(t[i]); });
          return api;
        },
        removeClass: function(c) {
          if (c === undefined) { els.forEach(function(n){ n.className = ''; }); return api; }
          var t = String(c).split(/\\s+/).filter(Boolean);
          els.forEach(function(n){ for (var i = 0; i < t.length; i++) n.classList.remove(t[i]); });
          return api;
        },
        toggleClass: function(c) {
          var t = String(c).split(/\\s+/).filter(Boolean);
          els.forEach(function(n){ for (var i = 0; i < t.length; i++) n.classList.toggle(t[i]); });
          return api;
        },
        hasClass: function(c) {
          var t = String(c).split(/\\s+/).filter(Boolean);
          return t.every(function(x){ return els.some(function(n){ return n.classList.contains(x); }); });
        },
        on: function(evt, a, b) {
          if (typeof a === 'string' && typeof b === 'function') {
            // 事件委托：.on(evt, 'selector', handler)（jQuery 形式，如 $(document).on('click', '.sb-tab', fn)）
            var sel = a;
            var fn = b;
            els.forEach(function(n){
              n.addEventListener(evt, function(e){
                var t = e.target;
                if (!t || typeof t.closest !== 'function') return;
                var hit = t.closest(sel);
                if (hit && (n === document || n.contains(hit))) fn.call(hit, e);
              });
            });
          } else {
            els.forEach(function(n){ n.addEventListener(evt, a); });
          }
          return api;
        },
        off: function(evt, a, b) {
          if (typeof a === 'function') {
            els.forEach(function(n){ n.removeEventListener(evt, a); });
          }
          return api;
        },
        hide: function() { els.forEach(function(n){ n.style.display = 'none'; }); return api; },
        show: function() { els.forEach(function(n){ n.style.display = ''; }); return api; },
        prop: function(k, v) {
          if (v === undefined) return els.length ? els[0][k] : undefined;
          els.forEach(function(n){ n[k] = v; });
          return api;
        },
        append: function(x) {
          els.forEach(function(n){
            if (typeof x === 'string') n.insertAdjacentHTML('beforeend', x);
            else if (x && x.isJq) {
              for (var i = 0; i < x.length; i++) {
                var cj = x.get(i);
                if (cj && cj.nodeType) n.appendChild(cj);
              }
            } else if (x && x.length !== undefined && typeof x !== 'function') {
              for (var j = 0; j < x.length; j++) {
                var c = x[j];
                if (c && c.nodeType) n.appendChild(c);
              }
            } else if (x && x.nodeType) n.appendChild(x);
          });
          return api;
        },
        empty: function() { els.forEach(function(n){ n.innerHTML = ''; }); return api; },
        find: function(s) { var out = []; els.forEach(function(n){ out = out.concat(Array.prototype.slice.call(n.querySelectorAll(s))); }); return mk(out); },
        closest: function(s) { var out = []; els.forEach(function(n){ var c = n.closest(s); if (c) out.push(c); }); return mk(out); },
        parent: function() { var out = []; els.forEach(function(n){ if (n.parentNode) out.push(n.parentNode); }); return mk(out); },
        children: function() { var out = []; els.forEach(function(n){ out = out.concat(Array.prototype.slice.call(n.children)); }); return mk(out); },
        first: function() { return mk(els.slice(0, 1)); },
        eq: function(i) { return mk(i >= 0 ? els.slice(i, i+1) : els.slice(els.length + i, els.length + i + 1)); },
        get: function(i) { return els[i]; },
        remove: function() { els.forEach(function(n){ if (n.parentNode) n.parentNode.removeChild(n); }); return api; }
      };
      return api;
    }
    return mk(nodes);
  }
  jq.fn = {};
  window.$ = jq;

  window.errorCatched = function(fn) { return fn; };
  window.waitGlobalInitialized = function() { return Promise.resolve(); };
  window.getCurrentMessageId = function() { return 0; };
  window.getLastMessageId = function() { return 0; };
  window.getScriptId = function() { return 'sandbox'; };
  window.getVariables = function() { return { stat_data: __mvu.stat_data }; };
  window.getAllVariables = function() { return { stat_data: __mvu.stat_data }; };
  window.updateVariablesWith = function(fn) {
    var result = fn(_.cloneDeep({ stat_data: __mvu.stat_data })) || { stat_data: __mvu.stat_data };
    __mvu.stat_data = result.stat_data;
    __listeners.forEach(function(cb) { try { cb(__mvu.stat_data); } catch(e){} });
    window.parent.postMessage({ source: 'mvu-sandbox', type: 'data', stat_data: __mvu.stat_data }, '*');
    return Promise.resolve();
  };
  window.createChatMessages = function() { return Promise.resolve(); };
  window.triggerSlash = function() { return Promise.resolve(); };
  window.eventOn = function(evt, cb) { __listeners.push(cb); };
  window.toastr = { success: function(){}, error: function(){}, warning: function(){} };
  window.YAML = { stringify: function(o){ return JSON.stringify(o, null, 2); }, parse: JSON.parse };
  window.Mvu = {
    events: {
      VARIABLE_INITIALIZED: 'VARIABLE_INITIALIZED',
      VARIABLE_UPDATE_STARTED: 'VARIABLE_UPDATE_STARTED',
      COMMAND_PARSED: 'COMMAND_PARSED',
      VARIABLE_UPDATE_ENDED: 'VARIABLE_UPDATE_ENDED',
      BEFORE_MESSAGE_UPDATE: 'BEFORE_MESSAGE_UPDATE'
    },
    getMvuData: function() { return { stat_data: __mvu.stat_data }; },
    replaceMvuData: function(data) {
      __mvu.stat_data = data.stat_data || {};
      __listeners.forEach(function(cb) { try { cb(__mvu.stat_data); } catch(e){} });
      window.parent.postMessage({ source: 'mvu-sandbox', type: 'data', stat_data: __mvu.stat_data }, '*');
      return Promise.resolve();
    },
    isDuringExtraAnalysis: function() { return false; }
  };

  window.addEventListener('message', function(e) {
    if (e.data && e.data.source === 'mvu-sandbox-host' && e.data.type === 'set-data') {
      __mvu.stat_data = e.data.stat_data;
      __listeners.forEach(function(cb) { try { cb(__mvu.stat_data); } catch(e){} });
    }
  });
})();
<\/script>`
}

function buildSrcdoc(html: string): string {
  // 去掉用户 HTML 中已有的完整文档结构包裹（沙盒自己提供骨架），
  // 但保留原 <head> 里的 <style>/<link> 样式块，否则沙盒 CSS 会全部丢失
  const styleBlocks: string[] = []
  let inner = html
    .replace(/<!doctype html>/gi, '')
    .replace(/<html[^>]*>/gi, '')
    .replace(/<\/html>/gi, '')
    .replace(/<head[^>]*>([\s\S]*?)<\/head>/gi, (_m, head: string) => {
      const styles = head.match(/<style[\s\S]*?<\/style>/gi) ?? []
      const links = head.match(/<link[^>]*rel=['"]?stylesheet['"]?[^>]*>/gi) ?? []
      styleBlocks.push(...styles, ...links)
      return ''
    })
    .replace(/<body[^>]*>/gi, '')
    .replace(/<\/body>/gi, '')
  // 模拟酒馆渲染管线对状态栏代码块做的一次 HTML 实体反转义（真实酒馆必做，预览必须一致）。
  // 否则 esc() 等 JS 里写 &amp;/&#39; 实体原文的代码在预览不报错、注入酒馆后 '&#39;'→''' 直接 SyntaxError。
  inner = inner
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, '\u00A0')
  const initial = JSON.stringify(props.mockData ?? {})
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8">
<style>html,body{background:#000;color:#fff}</style>
${styleBlocks.join('\n')}
</head>
<body>
${mockGlobalsScript(initial)}
${inner}
</body>
</html>`
}

function reload(): void {
  version.value++
}

watch(
  () => props.html,
  () => reload(),
  { immediate: true }
)

// mockData 变化 → 重建 srcdoc（保证沙盒始终读取右侧变量 Mock；初始值内嵌在 srcdoc 中）
watch(
  () => props.mockData,
  () => reload(),
  { deep: true }
)

function onMessage(e: MessageEvent): void {
  if (e.data?.source !== 'mvu-sandbox') return
  if (e.data.type === 'data') {
    emit('change', e.data.stat_data)
  }
}

window.addEventListener('message', onMessage)
onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
})
</script>

<template>
  <div class="sandbox-frame">
    <iframe
      v-if="version"
      :key="version"
      class="sandbox-iframe"
      sandbox="allow-scripts allow-same-origin"
      :srcdoc="buildSrcdoc(html)"
    ></iframe>
  </div>
</template>

<style scoped>
.sandbox-frame {
  width: 100%;
  height: 100%;
}
.sandbox-iframe {
  width: 100%;
  height: 100%;
  border: 1px solid #25304a;
  border-radius: 8px;
  background: #000;
}
</style>
