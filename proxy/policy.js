'use strict';

const PLAYURL_PATH = /^\/pgc\/player\/(?:web\/(?:v2\/)?|api\/)playurl$/;
const SEASON_PATH = /^\/pgc\/view\/web\/(?:simple\/)?season$/;

function isAllowedPath(pathname) {
    return PLAYURL_PATH.test(pathname) || SEASON_PATH.test(pathname);
}

function isAllowedMethod(method) {
    return method === 'GET' || method === 'OPTIONS';
}

module.exports = { isAllowedMethod, isAllowedPath };
