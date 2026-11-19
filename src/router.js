'use strict';
// Method + path matching. Routes: {method, path, ...anything}. Path segments:
//   literal, ':name' (must match the id regex, else no match), or a final '*' (rest of the path, may be empty).
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

function compile(route) {
  return { route, segs: route.path.split('/') };
}

function matchSegs(segs, parts) {
  const params = {};
  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i];
    if (i >= parts.length) return null;
    if (seg === '*' && i === segs.length - 1) {
      params.rest = parts.slice(i).join('/');
      return params;
    }
    if (seg.startsWith(':')) {
      if (!ID_RE.test(parts[i])) return null;
      params[seg.slice(1)] = parts[i];
    } else if (seg !== parts[i]) {
      return null;
    }
  }
  return parts.length === segs.length ? params : null;
}

// createRouter(routes).resolve(method, pathname)
//   -> {type:'match', route, params} | {type:'not_found'} | {type:'method_not_allowed', allow:[...]}
function createRouter(routes) {
  const compiled = routes.map(compile);
  return {
    resolve(method, pathname) {
      const parts = String(pathname).split('/');
      const allow = [];
      for (const c of compiled) {
        const params = matchSegs(c.segs, parts);
        if (!params) continue;
        if (c.route.method === method) return { type: 'match', route: c.route, params };
        if (!allow.includes(c.route.method)) allow.push(c.route.method);
      }
      if (allow.length > 0) return { type: 'method_not_allowed', allow };
      return { type: 'not_found' };
    },
  };
}

// Path part of a request target; no decoding, no normalisation.
function pathnameOf(url) {
  const s = String(url);
  const end = s.search(/[?#]/);
  return end < 0 ? s : s.slice(0, end);
}

module.exports = { createRouter, pathnameOf, ID_RE };
