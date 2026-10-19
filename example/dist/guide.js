const CLOG_STYLED = Symbol.for("@marianmeres/clog-styled");
const SAFE_COLORS = {
    gray: "#969696",
    grey: "#969696",
    red: "#d26565",
    orange: "#cba14d",
    yellow: "#cba14d",
    green: "#3dc73d",
    teal: "#4dcba1",
    cyan: "#4dcba1",
    blue: "#67afd3",
    purple: "#8e8ed4",
    magenta: "#b080c8",
    pink: "#be5b9d"
};
const AUTO_PALETTE = [
    SAFE_COLORS.gray,
    SAFE_COLORS.red,
    SAFE_COLORS.orange,
    "#8eba36",
    SAFE_COLORS.green,
    SAFE_COLORS.teal,
    SAFE_COLORS.blue,
    SAFE_COLORS.purple,
    SAFE_COLORS.magenta,
    SAFE_COLORS.pink
];
const _autoColorCache = new Map();
function autoColor(namespace) {
    const cached = _autoColorCache.get(namespace);
    if (cached !== undefined) return cached;
    const color = AUTO_PALETTE[strHash(namespace) % AUTO_PALETTE.length];
    _autoColorCache.set(namespace, color);
    return color;
}
function strHash(str) {
    let hash = 0;
    for(let i = 0; i < str.length; i++){
        hash = (hash << 5) - hash + str.charCodeAt(i) | 0;
    }
    return hash >>> 0;
}
const LEVEL_MAP = {
    debug: "DEBUG",
    log: "INFO",
    warn: "WARNING",
    error: "ERROR"
};
const CLOG_SKIP = Symbol.for("@marianmeres/clog-skip");
const DEFAULT_JSON_FIELD_NAMES = {
    timestamp: "timestamp",
    level: "level",
    logger: "logger",
    message: "message",
    meta: "meta",
    arg: "arg",
    stack: "stack"
};
const CLOG_INSTANCE = Symbol.for("@marianmeres/clog-instance");
const GLOBAL_KEY = Symbol.for("@marianmeres/clog");
const GLOBAL = globalThis[GLOBAL_KEY] ??= {
    hook: undefined,
    writer: undefined,
    jsonOutput: false,
    debug: undefined
};
let _cachedRuntime = null;
function detectRuntime() {
    if (_cachedRuntime !== null) return _cachedRuntime;
    if (typeof window !== "undefined" && window?.document) {
        return _cachedRuntime = "browser";
    }
    if (globalThis.Deno?.version?.deno) return _cachedRuntime = "deno";
    if (globalThis.process?.versions?.node) {
        return _cachedRuntime = "node";
    }
    return _cachedRuntime = "unknown";
}
const CLOG_FRAME_MARKERS = [
    "clog.ts",
    "colors.ts"
];
function isClogFrame(line) {
    return CLOG_FRAME_MARKERS.some((m)=>line.includes(m));
}
function captureStackLines(limit) {
    const stack = new Error().stack || "";
    const lines = stack.split("\n");
    const relevant = [];
    for (const raw of lines){
        const line = raw.trimEnd();
        if (!line) continue;
        if (/^Error(:|$)/.test(line.trim())) continue;
        if (isClogFrame(line)) continue;
        relevant.push(line);
    }
    if (typeof limit === "number" && limit > 0) {
        return relevant.slice(0, limit);
    }
    return relevant;
}
function formatStack(lines) {
    return "\n---\nStack:\n" + lines.map((v)=>"  " + v.trim()).join("\n");
}
function renderNs(ns) {
    if (!ns) return "";
    return ns.split(":").map((s)=>`[${s}]`).join(" ");
}
function _stringifyArgs(args, config) {
    if (!(config?.stringify ?? GLOBAL.stringify)) return args;
    return args.map((arg)=>{
        if (arg === null || arg === undefined) return arg;
        if (typeof arg !== "object") return arg;
        if (arg?.[CLOG_STYLED]) return arg.text;
        try {
            return JSON.stringify(arg);
        } catch  {
            return String(arg);
        }
    });
}
function stringifyValue(arg) {
    if (arg === null) return "null";
    if (arg === undefined) return "undefined";
    if (typeof arg !== "object") return String(arg);
    if (arg?.[CLOG_STYLED]) return arg.text;
    try {
        return JSON.stringify(arg);
    } catch  {
        return String(arg);
    }
}
function _hasStyledArgs(args) {
    return args.some((arg)=>arg?.[CLOG_STYLED]);
}
function _cleanStyledArgs(args) {
    return args.map((arg)=>arg?.[CLOG_STYLED] ? arg.text : arg);
}
function _processStyledArgs(args) {
    let format = "";
    const values = [];
    for (const arg of args){
        if (arg?.[CLOG_STYLED]) {
            format += `%c${arg.text}%c `;
            values.push(arg.style, "");
        } else if (typeof arg === "string") {
            format += `${arg} `;
        } else {
            format += "%o ";
            values.push(arg);
        }
    }
    return [
        format.trim(),
        values
    ];
}
function firstArgAsString(args, config) {
    if (args.length === 0) return "";
    const concat = config?.concat ?? GLOBAL.concat;
    const stringify = config?.stringify ?? GLOBAL.stringify;
    if (concat || stringify) return stringifyValue(args[0]);
    return String(args[0] ?? "");
}
function _resolveMetaSource(src) {
    if (!src) return undefined;
    try {
        return typeof src === "function" ? src() : src;
    } catch  {
        return undefined;
    }
}
function _mergeMetaSources(sources) {
    let out;
    for (const src of sources){
        const resolved = _resolveMetaSource(src);
        if (resolved != null) out = Object.assign(out ?? {}, resolved);
    }
    return out;
}
const CORE_JSON_FIELDS = [
    "timestamp",
    "level",
    "logger",
    "message",
    "meta",
    "stack"
];
function _isReservedJsonKey(key, names) {
    if (CORE_JSON_FIELDS.some((k)=>names[k] === key)) return true;
    const prefix = `${names.arg}_`;
    return key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length));
}
function toJsonRecord(data) {
    const { level, namespace, timestamp, config, stack } = data;
    const args = _cleanStyledArgs(_stringifyArgs(data.args, config));
    const fieldNames = {
        ...DEFAULT_JSON_FIELD_NAMES,
        ...GLOBAL.jsonFieldNames,
        ...config?.jsonFieldNames
    };
    const meta = data.meta;
    let promoted;
    let rest;
    const topLevelKeys = config?.jsonTopLevelMeta ?? GLOBAL.jsonTopLevelMeta;
    if (meta && topLevelKeys?.length) {
        for (const key of topLevelKeys){
            if (!Object.hasOwn(meta, key) || meta[key] === undefined) continue;
            if (_isReservedJsonKey(key, fieldNames)) continue;
            rest ??= {
                ...meta
            };
            (promoted ??= {})[key] = meta[key];
            delete rest[key];
        }
    }
    const writtenMeta = rest ? Object.keys(rest).length ? rest : undefined : meta;
    const record = {
        [fieldNames.timestamp]: timestamp,
        [fieldNames.level]: level,
        ...namespace ? {
            [fieldNames.logger]: namespace
        } : {},
        [fieldNames.message]: args[0],
        ...promoted,
        ...writtenMeta && {
            [fieldNames.meta]: writtenMeta
        }
    };
    args.slice(1).forEach((arg, i)=>{
        record[`${fieldNames.arg}_${i}`] = arg?.stack ?? arg;
    });
    if (stack && stack.length) record[fieldNames.stack] = formatStack(stack);
    return record;
}
const CONSOLE_METHOD = {
    DEBUG: "debug",
    INFO: "log",
    WARNING: "warn",
    ERROR: "error"
};
const defaultWriter = (data)=>{
    const { level, namespace, args, timestamp, config, stack } = data;
    const runtime = detectRuntime();
    const consoleMethod = CONSOLE_METHOD[level];
    const nsText = renderNs(namespace);
    const stackStr = stack && stack.length ? formatStack(stack) : null;
    const shouldConcat = config?.concat ?? GLOBAL.concat;
    if (shouldConcat) {
        const stringified = args.map(stringifyValue).join(" ");
        const output = runtime === "browser" ? nsText ? `${nsText} ${stringified}` : stringified : `[${timestamp}] [${level}]${nsText ? ` ${nsText}` : ""} ${stringified}`;
        console[consoleMethod](output, ...stackStr ? [
            stackStr
        ] : []);
        return;
    }
    if (runtime !== "browser" && (config?.jsonOutput ?? GLOBAL.jsonOutput)) {
        console[consoleMethod](JSON.stringify(toJsonRecord(data)));
        return;
    }
    const processedArgs = _stringifyArgs(args, config);
    const hasStyled = _hasStyledArgs(processedArgs);
    if ((runtime === "browser" || runtime === "deno") && hasStyled) {
        const [content, contentValues] = _processStyledArgs(processedArgs);
        if (runtime === "browser") {
            console[consoleMethod](nsText ? `${nsText} ${content}` : content, ...contentValues, ...stackStr ? [
                stackStr
            ] : []);
        } else {
            const prefix = `[${timestamp}] [${level}]${nsText ? ` ${nsText}` : ""}`;
            console[consoleMethod](`${prefix} ${content}`, ...contentValues, ...stackStr ? [
                stackStr
            ] : []);
        }
        return;
    }
    const cleanedArgs = _cleanStyledArgs(processedArgs);
    if (runtime === "browser") {
        if (nsText) {
            console[consoleMethod](nsText, ...cleanedArgs, ...stackStr ? [
                stackStr
            ] : []);
        } else {
            console[consoleMethod](...cleanedArgs, ...stackStr ? [
                stackStr
            ] : []);
        }
        return;
    }
    const prefix = `[${timestamp}] [${level}]${nsText ? ` ${nsText}` : ""}`.trim();
    console[consoleMethod](prefix, ...cleanedArgs, ...stackStr ? [
        stackStr
    ] : []);
};
const colorWriter = (configuredColor)=>(data)=>{
        const { level, namespace, args, timestamp, config, stack } = data;
        const runtime = detectRuntime();
        if (runtime !== "browser" && runtime !== "deno" || !namespace || (config?.concat ?? GLOBAL.concat) || (config?.jsonOutput ?? GLOBAL.jsonOutput)) {
            return defaultWriter(data);
        }
        const color = configuredColor === "auto" ? autoColor(namespace) : configuredColor;
        const processedArgs = _stringifyArgs(args, config);
        const consoleMethod = CONSOLE_METHOD[level];
        const stackStr = stack && stack.length ? formatStack(stack) : null;
        const nsText = renderNs(namespace);
        if (_hasStyledArgs(processedArgs)) {
            const [content, contentValues] = _processStyledArgs(processedArgs);
            if (runtime === "browser") {
                console[consoleMethod](`%c${nsText}%c ${content}`, `color:${color}`, "", ...contentValues, ...stackStr ? [
                    stackStr
                ] : []);
            } else {
                const prefix = `[${timestamp}] [${level}] %c${nsText}%c`;
                console[consoleMethod](`${prefix} ${content}`, `color:${color}`, "", ...contentValues, ...stackStr ? [
                    stackStr
                ] : []);
            }
            return;
        }
        if (runtime === "browser") {
            console[consoleMethod](`%c${nsText}`, `color:${color}`, ...processedArgs, ...stackStr ? [
                stackStr
            ] : []);
        } else {
            const prefix = `[${timestamp}] [${level}] %c${nsText}`;
            console[consoleMethod](prefix, `color:${color}`, ...processedArgs, ...stackStr ? [
                stackStr
            ] : []);
        }
    };
function createClog(namespace, config) {
    const ns = namespace ?? false;
    const _apply = (level, args)=>{
        const clonedArgs = args.slice();
        const getMetaFn = config?.getMeta ?? GLOBAL.getMeta;
        const extraMeta = config?.meta;
        const stacktraceConfig = config?.stacktrace ?? GLOBAL.stacktrace;
        const stack = stacktraceConfig ? captureStackLines(typeof stacktraceConfig === "number" ? stacktraceConfig : undefined) : undefined;
        const data = {
            level: LEVEL_MAP[level],
            namespace: ns,
            args: clonedArgs,
            timestamp: new Date().toISOString(),
            config,
            stack
        };
        if (getMetaFn || extraMeta) {
            let _meta;
            let _metaComputed = false;
            Object.defineProperty(data, "meta", {
                get () {
                    if (!_metaComputed) {
                        _metaComputed = true;
                        _meta = extraMeta ? _mergeMetaSources([
                            getMetaFn,
                            extraMeta
                        ]) : _resolveMetaSource(getMetaFn);
                    }
                    return _meta;
                },
                enumerable: true,
                configurable: true
            });
        }
        const hookResult = GLOBAL.hook?.(data);
        if (hookResult !== CLOG_SKIP) {
            let writer = GLOBAL.writer ?? config?.writer;
            if (!writer && config?.color) writer = colorWriter(config.color);
            writer = writer ?? defaultWriter;
            writer(data);
        }
        return firstArgAsString(clonedArgs, config);
    };
    const logger = (...args)=>_apply("log", args);
    logger.debug = (...args)=>{
        if ((config?.debug ?? GLOBAL.debug) === false) {
            return firstArgAsString(args, config);
        }
        return _apply("debug", args);
    };
    logger.log = (...args)=>_apply("log", args);
    logger.warn = (...args)=>_apply("warn", args);
    logger.error = (...args)=>_apply("error", args);
    Object.defineProperty(logger, "ns", {
        value: ns,
        writable: false
    });
    Object.defineProperty(logger, CLOG_INSTANCE, {
        value: {
            ns,
            config
        },
        enumerable: false,
        writable: false
    });
    return logger;
}
createClog.global = GLOBAL;
createClog.reset = ()=>{
    createClog.global.hook = undefined;
    createClog.global.writer = undefined;
    createClog.global.jsonOutput = false;
    createClog.global.jsonFieldNames = undefined;
    createClog.global.jsonTopLevelMeta = undefined;
    createClog.global.debug = undefined;
    createClog.global.stringify = undefined;
    createClog.global.concat = undefined;
    createClog.global.stacktrace = undefined;
    createClog.global.getMeta = undefined;
};
if (typeof Symbol.dispose === "undefined") {
    Symbol.dispose = Symbol.for("Symbol.dispose");
}
const WILDCARD = "*";
class PubSub {
    #subs = new Map();
    #onError;
    constructor(options){
        this.#onError = options?.onError ?? this.#defaultErrorHandler;
        this.publish = this.publish.bind(this);
        this.subscribe = this.subscribe.bind(this);
        this.subscribeOnce = this.subscribeOnce.bind(this);
        this.subscribeMany = this.subscribeMany.bind(this);
        this.unsubscribe = this.unsubscribe.bind(this);
        this.unsubscribeAll = this.unsubscribeAll.bind(this);
        this.isSubscribed = this.isSubscribed.bind(this);
        this.subscriberCount = this.subscriberCount.bind(this);
        this.hasSubscribers = this.hasSubscribers.bind(this);
        this.topics = this.topics.bind(this);
    }
    #defaultErrorHandler(error, topic, isWildcard) {
        const prefix = isWildcard ? "wildcard subscriber" : "subscriber";
        console.error(`Error in ${prefix} for topic "${topic}":`, error);
    }
    #invoke(cb, data, topic, isWildcard) {
        try {
            const result = cb(data);
            if (result && typeof result.then === "function") {
                result.catch((reason)=>{
                    const err = reason instanceof Error ? reason : new Error(String(reason));
                    this.#onError(err, topic, isWildcard);
                });
            }
        } catch (error) {
            this.#onError(error, topic, isWildcard);
        }
    }
    #makeUnsubscriber(fn) {
        const u = ()=>fn();
        u[Symbol.dispose] = fn;
        return u;
    }
    publish(topic, data) {
        if (topic === WILDCARD) {
            throw new Error(`Cannot publish to wildcard topic "*". "*" is reserved for subscribers; publish to a real topic name instead.`);
        }
        const direct = this.#subs.get(topic);
        const hadDirect = !!direct && direct.size > 0;
        if (direct) {
            for (const cb of [
                ...direct
            ]){
                this.#invoke(cb, data, topic, false);
            }
        }
        const wildcards = this.#subs.get(WILDCARD);
        if (wildcards && wildcards.size > 0) {
            const envelope = {
                event: topic,
                data
            };
            for (const cb of [
                ...wildcards
            ]){
                this.#invoke(cb, envelope, topic, true);
            }
        }
        return hadDirect;
    }
    subscribe(topic, cb) {
        let bucket = this.#subs.get(topic);
        if (!bucket) {
            bucket = new Set();
            this.#subs.set(topic, bucket);
        }
        bucket.add(cb);
        return this.#makeUnsubscriber(()=>{
            this.unsubscribe(topic, cb);
        });
    }
    subscribeOnce(topic, cb) {
        let fired = false;
        const onceWrapper = (data)=>{
            if (fired) return;
            fired = true;
            this.unsubscribe(topic, onceWrapper);
            return cb(data);
        };
        return this.subscribe(topic, onceWrapper);
    }
    subscribeMany(topics, cb) {
        const unsubs = topics.map((t)=>this.subscribe(t, cb));
        return this.#makeUnsubscriber(()=>{
            for (const u of unsubs)u();
        });
    }
    unsubscribe(topic, cb) {
        const bucket = this.#subs.get(topic);
        if (!bucket) return false;
        if (typeof cb === "function") {
            const removed = bucket.delete(cb);
            if (bucket.size === 0) this.#subs.delete(topic);
            return removed;
        }
        return this.#subs.delete(topic);
    }
    unsubscribeAll(topic) {
        if (topic !== undefined) return this.#subs.delete(topic);
        if (this.#subs.size === 0) return false;
        this.#subs.clear();
        return true;
    }
    isSubscribed(topic, cb, considerWildcard = true) {
        if (this.#subs.get(topic)?.has(cb)) return true;
        if (considerWildcard && this.#subs.get(WILDCARD)?.has(cb)) return true;
        return false;
    }
    subscriberCount(topic) {
        if (topic !== undefined) return this.#subs.get(topic)?.size ?? 0;
        let total = 0;
        for (const set of this.#subs.values())total += set.size;
        return total;
    }
    hasSubscribers(topic) {
        return (this.#subs.get(topic)?.size ?? 0) > 0;
    }
    topics() {
        return [
            ...this.#subs.keys()
        ];
    }
    __dump() {
        const out = {};
        for (const [topic, set] of this.#subs.entries()){
            out[topic] = new Set(set);
        }
        return out;
    }
}
new Map();
createClog("micperms");
const _g = globalThis;
function detectPlatform(config) {
    if (config.platform) return config.platform;
    try {
        if (_g.webkit?.messageHandlers) return "ios-webview";
    } catch  {}
    try {
        if (_g[config.androidBridgeObject ?? "Android"]) {
            return "android-webview";
        }
    } catch  {}
    try {
        if (_g.matchMedia?.("(display-mode: standalone)").matches || _g.navigator?.standalone === true) {
            return "pwa";
        }
    } catch  {}
    return "browser";
}
const MIC_REENABLE_GUIDE_LANGS = [
    "en",
    "sk"
];
const _g1 = globalThis;
function isIOSUserAgent(ua) {
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    try {
        if (_g1.navigator?.platform === "MacIntel" && typeof _g1.navigator?.maxTouchPoints === "number" && _g1.navigator.maxTouchPoints > 1) {
            return true;
        }
    } catch  {}
    return false;
}
function isAndroidUserAgent(ua) {
    return /android/i.test(ua);
}
function detectFlavor(opts = {}) {
    if (opts.flavor) return opts.flavor;
    const platform = detectPlatform({
        platform: opts.platform
    });
    const ua = opts.userAgent ?? _g1.navigator?.userAgent ?? "";
    if (platform === "ios-webview") return "ios-webview";
    if (platform === "android-webview") return "android-webview";
    const ios = isIOSUserAgent(ua);
    const android = isAndroidUserAgent(ua);
    if (platform === "pwa") {
        if (ios) return "ios-pwa";
        if (android) return "android-pwa";
        return "desktop";
    }
    if (ios) return "ios-safari";
    if (android) return "android-chrome";
    return "desktop";
}
const ART = {
    addressbarIOS: `<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="40" y="58" width="240" height="42" rx="11" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<g class="mpg-pulse">
			<rect x="51" y="65" width="28" height="28" rx="7" fill="var(--mpg-accent-soft)"/>
			<rect x="58" y="71" width="14" height="16" rx="2.2" fill="none" stroke="var(--mpg-accent)" stroke-width="1.4"/>
			<line x1="61" y1="76" x2="69" y2="76" stroke="var(--mpg-accent)" stroke-width="1.3" stroke-linecap="round"/>
			<line x1="61" y1="80" x2="69" y2="80" stroke="var(--mpg-accent)" stroke-width="1.3" stroke-linecap="round"/>
			<line x1="61" y1="84" x2="66" y2="84" stroke="var(--mpg-accent)" stroke-width="1.3" stroke-linecap="round"/>
		</g>
		<rect x="92" y="73" width="158" height="12" rx="6" fill="var(--mpg-art-soft)"/>
		<g transform="translate(259 72) scale(0.875)" fill="var(--mpg-muted)"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></g>
		<path d="M65 62 L65 48" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-dasharray="3 3"/>
		<circle cx="65" cy="46" r="3" fill="var(--mpg-accent)"/>
	</svg>`,
    addressbarAndroid: `<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="40" y="58" width="240" height="42" rx="11" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<g class="mpg-pulse">
			<rect x="51" y="65" width="28" height="28" rx="7" fill="var(--mpg-accent-soft)"/>
			<line x1="57" y1="73" x2="73" y2="73" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-linecap="round"/>
			<circle cx="68" cy="73" r="2.4" fill="var(--mpg-art-bg)" stroke="var(--mpg-accent)" stroke-width="1.4"/>
			<line x1="57" y1="79" x2="73" y2="79" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-linecap="round"/>
			<circle cx="60" cy="79" r="2.4" fill="var(--mpg-art-bg)" stroke="var(--mpg-accent)" stroke-width="1.4"/>
			<line x1="57" y1="85" x2="73" y2="85" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-linecap="round"/>
			<circle cx="65" cy="85" r="2.4" fill="var(--mpg-art-bg)" stroke="var(--mpg-accent)" stroke-width="1.4"/>
		</g>
		<rect x="92" y="73" width="158" height="12" rx="6" fill="var(--mpg-art-soft)"/>
		<g transform="translate(259 72) scale(0.875)" fill="var(--mpg-muted)"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></g>
		<path d="M65 62 L65 48" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-dasharray="3 3"/>
		<circle cx="65" cy="46" r="3" fill="var(--mpg-accent)"/>
	</svg>`,
    addressbarDesktop: `<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="28" y="22" width="264" height="92" rx="10" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<line x1="28" y1="48" x2="292" y2="48" stroke="var(--mpg-line)"/>
		<circle cx="44" cy="35" r="4" fill="var(--mpg-art-soft)"/>
		<circle cx="58" cy="35" r="4" fill="var(--mpg-art-soft)"/>
		<circle cx="72" cy="35" r="4" fill="var(--mpg-art-soft)"/>
		<rect x="44" y="66" width="232" height="32" rx="8" fill="var(--mpg-bg)" stroke="var(--mpg-line)"/>
		<g class="mpg-pulse">
			<rect x="52" y="72" width="24" height="20" rx="5" fill="var(--mpg-accent-soft)"/>
			<path d="M59 81 v-3 a5 5 0 0 1 10 0 v3" fill="none" stroke="var(--mpg-accent)" stroke-width="1.5"/>
			<rect x="57" y="81" width="14" height="9" rx="1.6" fill="var(--mpg-accent)"/>
		</g>
		<rect x="86" y="77" width="170" height="10" rx="5" fill="var(--mpg-art-soft)"/>
		<g transform="translate(260 76) scale(0.75)" fill="var(--mpg-muted)"><path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/></g>
		<path d="M64 100 L64 118" stroke="var(--mpg-accent)" stroke-width="1.4" stroke-dasharray="3 3"/>
		<circle cx="64" cy="121" r="3" fill="var(--mpg-accent)"/>
	</svg>`,
    menu: `<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="78" y="22" width="164" height="114" rx="14" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<rect x="94" y="40" width="100" height="9" rx="4.5" fill="var(--mpg-art-soft)"/>
		<rect x="94" y="66" width="120" height="9" rx="4.5" fill="var(--mpg-art-soft)"/>
		<rect x="86" y="86" width="148" height="30" rx="8" fill="var(--mpg-accent-soft)" class="mpg-pulse"/>
		<rect x="94" y="96" width="96" height="10" rx="5" fill="var(--mpg-accent)"/>
		<path d="M214 101l5 5 9-10" stroke="var(--mpg-accent)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
	</svg>`,
    toggle: `<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="58" y="56" width="204" height="46" rx="12" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<rect x="74" y="74" width="86" height="10" rx="5" fill="var(--mpg-fg)"/>
		<rect x="196" y="69" width="52" height="20" rx="10" fill="#34c759" class="mpg-pulse"/>
		<circle cx="238" cy="79" r="8.5" fill="#fff"/>
	</svg>`,
    gear: `<svg viewBox="0 0 320 158" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<rect x="110" y="34" width="100" height="100" rx="22" fill="var(--mpg-art-bg)" stroke="var(--mpg-line)"/>
		<g transform="translate(160 84)">
			<g class="mpg-pulse">
				<path transform="scale(3.75) translate(-8 -8)" fill="var(--mpg-accent)" fill-rule="evenodd" d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
			</g>
		</g>
	</svg>`
};
const FLAVOR_ART = {
    "ios-safari": [
        ART.addressbarIOS,
        ART.menu,
        ART.toggle
    ],
    "android-chrome": [
        ART.addressbarAndroid,
        ART.menu,
        ART.toggle
    ],
    "desktop": [
        ART.addressbarDesktop,
        ART.menu,
        ART.toggle
    ],
    "ios-webview": [
        ART.gear,
        ART.toggle
    ],
    "android-webview": [
        ART.gear,
        ART.toggle
    ],
    "ios-pwa": [
        ART.gear,
        ART.toggle
    ],
    "android-pwa": [
        ART.gear,
        ART.menu,
        ART.toggle
    ]
};
const CHROME_TEXTS = {
    en: {
        title: "Re-enable the microphone",
        subtitle: "Microphone access is off. A few quick taps in your device settings turns it back on.",
        back: "Back",
        next: "Next",
        done: "Done",
        openSettings: "Open Settings"
    },
    sk: {
        title: "Povoliť mikrofón",
        subtitle: "Prístup k mikrofónu je vypnutý. Stačí pár klikov v nastaveniach zariadenia a znova ho zapnete.",
        back: "Späť",
        next: "Ďalej",
        done: "Hotovo",
        openSettings: "Otvoriť nastavenia"
    }
};
const STEP_TEXTS = {
    en: {
        "ios-safari": [
            "Tap the <b>page settings</b> icon at the left of the address bar.",
            "Choose <b>Website Settings</b>.",
            "Set <b>Microphone</b> to <b>Allow</b>, then reload the page."
        ],
        "android-chrome": [
            "Tap the <b>site info</b> icon at the left of the address bar.",
            "Open <b>Permissions</b>.",
            "Allow <b>Microphone</b>, then reload the page."
        ],
        "desktop": [
            "Click the <b>site info</b> icon in the address bar.",
            "Find <b>Microphone</b> in the permissions list.",
            "Set it to <b>Allow</b>, then reload the page."
        ],
        "ios-webview": [
            "Open the <b>Settings</b> app.",
            "Find this app and turn <b>Microphone</b> on."
        ],
        "android-webview": [
            "Open this app's <b>Settings</b>.",
            "Under <b>Permissions</b>, allow <b>Microphone</b>."
        ],
        "ios-pwa": [
            "Open <b>Settings → Apps → [this app]</b>.",
            "Turn <b>Microphone</b> on."
        ],
        "android-pwa": [
            "Open the device <b>Settings</b>.",
            "Go to <b>Apps → [this app] → Permissions</b>.",
            "Allow <b>Microphone</b>."
        ]
    },
    sk: {
        "ios-safari": [
            "Ťuknite na ikonu <b>nastavení stránky</b> vľavo od adresového riadku.",
            "Zvoľte <b>Nastavenia webovej stránky</b>.",
            "Nastavte <b>Mikrofón</b> na <b>Povoliť</b> a obnovte stránku."
        ],
        "android-chrome": [
            "Ťuknite na ikonu <b>info o stránke</b> vľavo od adresového riadku.",
            "Otvorte <b>Povolenia</b>.",
            "Povoľte <b>Mikrofón</b> a obnovte stránku."
        ],
        "desktop": [
            "Kliknite na ikonu <b>info o stránke</b> v adresovom riadku.",
            "Nájdite <b>Mikrofón</b> v zozname povolení.",
            "Nastavte ho na <b>Povoliť</b> a obnovte stránku."
        ],
        "ios-webview": [
            "Otvorte aplikáciu <b>Nastavenia</b>.",
            "Nájdite túto aplikáciu a zapnite <b>Mikrofón</b>."
        ],
        "android-webview": [
            "Otvorte <b>Nastavenia</b> tejto aplikácie.",
            "V sekcii <b>Povolenia</b> povoľte <b>Mikrofón</b>."
        ],
        "ios-pwa": [
            "Otvorte <b>Nastavenia → Aplikácie → [táto aplikácia]</b>.",
            "Zapnite <b>Mikrofón</b>."
        ],
        "android-pwa": [
            "Otvorte <b>Nastavenia</b> zariadenia.",
            "Prejdite na <b>Aplikácie → [táto aplikácia] → Povolenia</b>.",
            "Povoľte <b>Mikrofón</b>."
        ]
    }
};
function resolveLang(input) {
    if (input && input !== "auto") {
        return input in STEP_TEXTS ? input : "en";
    }
    try {
        const tag = (_g1.navigator?.language ?? "en").toLowerCase();
        const primary = tag.split("-")[0];
        if (primary in STEP_TEXTS) return primary;
    } catch  {}
    return "en";
}
function defaultStepsFor(flavor, lang) {
    const arts = FLAVOR_ART[flavor];
    const texts = STEP_TEXTS[lang][flavor];
    return texts.map((text, i)=>({
            text,
            art: arts[i]
        }));
}
const FLAVORS_WITH_SETTINGS_CTA = new Set([
    "ios-webview",
    "android-webview",
    "ios-pwa",
    "android-pwa"
]);
function resolveSteps(opts, flavor, lang) {
    if (typeof opts.steps === "function") {
        const out = opts.steps({
            flavor,
            lang,
            defaultSteps: defaultStepsFor(flavor, lang)
        });
        if (!Array.isArray(out)) {
            throw new Error("createMicReenableGuide: `steps` builder must return an array");
        }
        return out;
    }
    if (opts.steps !== undefined) return opts.steps;
    const texts = opts.stepText?.[flavor];
    if (texts && texts.length) {
        return defaultStepsFor(flavor, lang).map((step, i)=>{
            const text = texts[i];
            return text == null ? step : {
                ...step,
                text
            };
        });
    }
    return defaultStepsFor(flavor, lang);
}
function resolveText(input, flavor, lang, defaultText) {
    if (typeof input === "function") {
        return input({
            flavor,
            lang,
            defaultText
        });
    }
    return input ?? defaultText;
}
function resolveGuideConfig(opts) {
    const flavor = detectFlavor({
        platform: opts.platform,
        flavor: opts.flavor
    });
    const lang = resolveLang(opts.lang);
    const chrome = CHROME_TEXTS[lang];
    const steps = resolveSteps(opts, flavor, lang);
    if (steps.length === 0) {
        throw new Error("createMicReenableGuide: `steps` must not be empty");
    }
    return {
        flavor,
        lang,
        steps,
        title: resolveText(opts.title, flavor, lang, chrome.title),
        subtitle: resolveText(opts.subtitle, flavor, lang, chrome.subtitle),
        labels: {
            back: opts.labels?.back ?? chrome.back,
            next: opts.labels?.next ?? chrome.next,
            done: opts.labels?.done ?? chrome.done,
            openSettings: opts.labels?.openSettings ?? chrome.openSettings
        },
        showSettingsCta: !!opts.onOpenSettings && FLAVORS_WITH_SETTINGS_CTA.has(flavor)
    };
}
function createMicReenableGuideController(opts = {}) {
    const cfg = resolveGuideConfig(opts);
    const last = cfg.steps.length - 1;
    let i = 0;
    let destroyed = false;
    const subs = new Set();
    function snapshot() {
        return {
            index: i,
            total: cfg.steps.length,
            isFirst: i === 0,
            isLast: i === last,
            step: cfg.steps[i],
            steps: cfg.steps,
            flavor: cfg.flavor,
            lang: cfg.lang,
            title: cfg.title,
            subtitle: cfg.subtitle,
            labels: cfg.labels,
            hasOpenSettingsCta: cfg.showSettingsCta
        };
    }
    function setIndex(n) {
        if (destroyed) return;
        const clamped = Math.max(0, Math.min(last, n | 0));
        if (clamped !== i) {
            i = clamped;
            const s = snapshot();
            for (const run of subs)run(s);
        }
    }
    return {
        get index () {
            return i;
        },
        get flavor () {
            return cfg.flavor;
        },
        get lang () {
            return cfg.lang;
        },
        get steps () {
            return cfg.steps;
        },
        get: snapshot,
        next () {
            setIndex(i + 1);
        },
        back () {
            setIndex(i - 1);
        },
        goto (n) {
            setIndex(n);
        },
        done () {
            opts.onDone?.();
        },
        openSettings () {
            opts.onOpenSettings?.();
        },
        subscribe (run) {
            run(snapshot());
            subs.add(run);
            return ()=>{
                subs.delete(run);
            };
        },
        destroy () {
            destroyed = true;
            subs.clear();
        }
    };
}
const STYLE_ID = "mpg-styles";
const STYLE_CSS = `
.mpg {
	--mpg-bg: #ffffff;
	--mpg-fg: #1c1c1e;
	--mpg-muted: #8a8a8e;
	--mpg-accent: #007aff;
	--mpg-accent-soft: #007aff1a;
	--mpg-line: #e5e5ea;
	--mpg-art-bg: #f7f7fa;
	--mpg-art-soft: #e8e8ed;
	--mpg-radius: 16px;
	--mpg-font: -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif;

	width: 340px; max-width: 100%;
	background: var(--mpg-bg); color: var(--mpg-fg);
	border-radius: var(--mpg-radius);
	box-shadow: 0 12px 40px -8px rgba(0,0,0,.28), 0 0 0 .5px rgba(0,0,0,.04);
	overflow: hidden; font-family: var(--mpg-font);
	-webkit-font-smoothing: antialiased;
}
.mpg[data-theme="dark"] {
	--mpg-bg: #1c1c1e;
	--mpg-fg: #f2f2f7;
	--mpg-muted: #8e8e93;
	--mpg-line: #38383a;
	--mpg-art-bg: #2c2c2e;
	--mpg-art-soft: #3a3a3c;
	box-shadow: 0 12px 40px -8px rgba(0,0,0,.6), 0 0 0 .5px rgba(255,255,255,.06);
}
.mpg__head { padding: 20px 20px 4px; }
.mpg__title { font-size: 18px; font-weight: 600; letter-spacing: -.01em; margin: 0; }
.mpg__sub { font-size: 13.5px; color: var(--mpg-muted); margin: 6px 0 0; line-height: 1.45; }
.mpg__stage { padding: 14px 20px 4px; }
.mpg__art {
	height: 158px; border-radius: 12px; background: var(--mpg-art-bg);
	border: 1px solid var(--mpg-line); display: grid; place-items: center;
	overflow: hidden; position: relative;
}
.mpg__art svg { width: 100%; height: 100%; }
.mpg__step { padding: 14px 20px 4px; }
.mpg__step-default { display: flex; gap: 10px; align-items: flex-start; }
.mpg__num {
	flex: 0 0 auto; width: 22px; height: 22px; border-radius: 50%;
	background: var(--mpg-accent); color: #fff; font-size: 12.5px; font-weight: 600;
	display: grid; place-items: center; margin-top: 1px;
}
.mpg__text { font-size: 14.5px; line-height: 1.5; }
.mpg__text b { font-weight: 600; }
.mpg__dots { display: flex; gap: 6px; justify-content: center; padding: 14px 0 4px; }
.mpg__dot {
	width: 6px; height: 6px; border-radius: 50%; background: var(--mpg-line);
	transition: background .2s, width .2s;
}
.mpg__dot--on { background: var(--mpg-accent); width: 18px; border-radius: 3px; }
.mpg__foot { padding: 12px 20px 18px; }
.mpg__foot-default { display: flex; gap: 10px; }
.mpg__btn {
	flex: 1; height: 44px; border-radius: 11px; border: 0; cursor: pointer;
	font-family: inherit; font-size: 15px; font-weight: 600;
	transition: opacity .15s, transform .05s;
}
.mpg__btn:active { transform: scale(.985); }
.mpg__btn--ghost { background: transparent; color: var(--mpg-accent); }
.mpg__btn--ghost:disabled { color: var(--mpg-muted); opacity: .4; cursor: default; }
.mpg__btn--solid { background: var(--mpg-accent); color: #fff; }
.mpg-pulse {
	transform-box: fill-box; transform-origin: center;
	animation: mpgPulse 1.6s ease-in-out infinite;
}
@keyframes mpgPulse {
	0%, 100% { opacity: .35; transform: scale(1); }
	50% { opacity: 1; transform: scale(1.06); }
}
@media (prefers-reduced-motion: reduce) {
	.mpg-pulse { animation: none; opacity: 1; }
}
`;
function ensureStyles() {
    if (typeof document === "undefined") return;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE_CSS;
    document.head.appendChild(style);
}
function createMicReenableGuide(opts) {
    if (!opts?.container) {
        throw new Error("createMicReenableGuide: `container` is required");
    }
    if (typeof document === "undefined") {
        throw new Error("createMicReenableGuide: requires a DOM environment");
    }
    ensureStyles();
    const ctrl = createMicReenableGuideController({
        platform: opts.platform,
        flavor: opts.flavor,
        lang: opts.lang,
        steps: opts.steps,
        stepText: opts.stepText,
        title: opts.title,
        subtitle: opts.subtitle,
        labels: opts.labels,
        onOpenSettings: opts.onOpenSettings,
        onDone: opts.onDone
    });
    const { lang, steps } = ctrl;
    const root = document.createElement("div");
    root.className = "mpg";
    root.lang = lang;
    if (opts.accent) root.style.setProperty("--mpg-accent", opts.accent);
    root.innerHTML = `
		<div class="mpg__head" data-head></div>
		<div class="mpg__stage"><div class="mpg__art" data-art></div></div>
		<div class="mpg__step" data-step></div>
		<div class="mpg__dots" data-dots></div>
		<div class="mpg__foot" data-foot></div>
	`;
    const $head = root.querySelector("[data-head]");
    const $art = root.querySelector("[data-art]");
    const $step = root.querySelector("[data-step]");
    const $dotsHost = root.querySelector("[data-dots]");
    const $foot = root.querySelector("[data-foot]");
    const dots = steps.map(()=>{
        const d = document.createElement("span");
        d.className = "mpg__dot";
        $dotsHost.appendChild(d);
        return d;
    });
    const slots = opts.slots ?? {};
    let destroyed = false;
    let themeObserver = null;
    function mountInto(host, out) {
        if (out == null) return false;
        host.replaceChildren();
        if (typeof out === "string") host.innerHTML = out;
        else host.appendChild(out);
        return true;
    }
    function appendSlotOutput(host, out) {
        if (typeof out === "string") {
            const tpl = document.createElement("template");
            tpl.innerHTML = out;
            host.appendChild(tpl.content);
        } else {
            host.appendChild(out);
        }
    }
    function buildCtx() {
        const snap = ctrl.get();
        return {
            ...snap,
            next () {
                if (destroyed) return;
                ctrl.next();
            },
            back () {
                if (destroyed) return;
                ctrl.back();
            },
            goto (n) {
                if (destroyed) return;
                ctrl.goto(n);
            },
            done () {
                ctrl.done();
            },
            openSettings () {
                ctrl.openSettings();
            }
        };
    }
    function renderHeader(ctx) {
        if (slots.header && mountInto($head, slots.header(ctx))) return;
        $head.replaceChildren();
        const h = document.createElement("h2");
        h.className = "mpg__title";
        h.textContent = ctx.title;
        const p = document.createElement("p");
        p.className = "mpg__sub";
        p.textContent = ctx.subtitle;
        $head.append(h, p);
    }
    function renderArt(ctx) {
        if (slots.art && mountInto($art, slots.art(ctx))) return;
        $art.replaceChildren();
        const art = ctx.step.art;
        if (!art) return;
        if (typeof art === "string") $art.innerHTML = art;
        else $art.appendChild(art);
    }
    function renderStep(ctx) {
        if (slots.step && mountInto($step, slots.step(ctx))) return;
        $step.replaceChildren();
        const wrap = document.createElement("div");
        wrap.className = "mpg__step-default";
        const num = document.createElement("div");
        num.className = "mpg__num";
        num.textContent = String(ctx.index + 1);
        const text = document.createElement("div");
        text.className = "mpg__text";
        text.innerHTML = ctx.step.text;
        wrap.append(num, text);
        $step.appendChild(wrap);
    }
    function buttonContexts(ctx) {
        const primaryRole = ctx.hasOpenSettingsCta && ctx.isFirst ? "open-settings" : ctx.isLast ? "done" : "next";
        const primaryLabel = primaryRole === "open-settings" ? ctx.labels.openSettings : primaryRole === "done" ? ctx.labels.done : ctx.labels.next;
        const primaryClick = ()=>{
            if (destroyed) return;
            if (primaryRole === "open-settings") {
                ctx.openSettings();
                ctx.next();
                return;
            }
            if (primaryRole === "done") {
                ctx.done();
                return;
            }
            ctx.next();
        };
        const backClick = ()=>{
            if (destroyed) return;
            ctx.back();
        };
        return [
            {
                ...ctx,
                role: "back",
                label: ctx.labels.back,
                disabled: ctx.isFirst,
                onClick: backClick
            },
            {
                ...ctx,
                role: primaryRole,
                label: primaryLabel,
                disabled: false,
                onClick: primaryClick
            }
        ];
    }
    function renderDefaultButton(b) {
        const el = document.createElement("button");
        el.type = "button";
        el.className = b.role === "back" ? "mpg__btn mpg__btn--ghost" : "mpg__btn mpg__btn--solid";
        el.textContent = b.label;
        el.disabled = b.disabled;
        el.dataset.role = b.role;
        el.addEventListener("click", b.onClick);
        return el;
    }
    function renderFooter(ctx) {
        if (slots.footer && mountInto($foot, slots.footer(ctx))) return;
        $foot.replaceChildren();
        const wrap = document.createElement("div");
        wrap.className = "mpg__foot-default";
        for (const b of buttonContexts(ctx)){
            if (slots.button) {
                const out = slots.button(b);
                if (out != null) {
                    appendSlotOutput(wrap, out);
                    continue;
                }
            }
            wrap.appendChild(renderDefaultButton(b));
        }
        $foot.appendChild(wrap);
    }
    function render() {
        const ctx = buildCtx();
        renderHeader(ctx);
        renderArt(ctx);
        renderStep(ctx);
        dots.forEach((d, n)=>d.classList.toggle("mpg__dot--on", n === ctx.index));
        renderFooter(ctx);
    }
    function applyThemeAttr(isDark) {
        root.dataset.theme = isDark ? "dark" : "light";
    }
    function resolveAuto() {
        try {
            return document.documentElement.classList.contains("dark");
        } catch  {
            return false;
        }
    }
    function setTheme(theme) {
        if (themeObserver) {
            themeObserver.disconnect();
            themeObserver = null;
        }
        if (theme === "auto") {
            applyThemeAttr(resolveAuto());
            if (typeof MutationObserver !== "undefined") {
                themeObserver = new MutationObserver(()=>{
                    applyThemeAttr(resolveAuto());
                });
                themeObserver.observe(document.documentElement, {
                    attributes: true,
                    attributeFilter: [
                        "class"
                    ]
                });
            }
        } else {
            applyThemeAttr(theme === "dark");
        }
    }
    setTheme(opts.theme ?? "auto");
    const unsubscribeCtrl = ctrl.subscribe(()=>{
        if (!destroyed) render();
    });
    opts.container.appendChild(root);
    const api = {
        el: root,
        get index () {
            return ctrl.index;
        },
        next () {
            if (destroyed) return;
            ctrl.next();
        },
        back () {
            if (destroyed) return;
            ctrl.back();
        },
        goto (n) {
            if (destroyed) return;
            ctrl.goto(n);
        },
        setTheme,
        destroy () {
            if (destroyed) return;
            destroyed = true;
            unsubscribeCtrl();
            ctrl.destroy();
            if (themeObserver) {
                themeObserver.disconnect();
                themeObserver = null;
            }
            if (root.parentNode) root.parentNode.removeChild(root);
        }
    };
    return api;
}
export { MIC_REENABLE_GUIDE_LANGS as MIC_REENABLE_GUIDE_LANGS };
export { detectFlavor as detectFlavor };
export { defaultStepsFor as defaultStepsFor };
export { createMicReenableGuideController as createMicReenableGuideController };
export { createMicReenableGuide as createMicReenableGuide };
