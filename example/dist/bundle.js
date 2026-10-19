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
function createPubSub(options) {
    return new PubSub(options);
}
const isFn = (v)=>typeof v === "function";
const assertFn = (v, prefix = "")=>{
    if (!isFn(v)) throw new TypeError(`${prefix} Expecting function arg`.trim());
};
const strictEqual = (a, b)=>a === b;
function createStore(initial, options = null) {
    const _equal = options?.equal ?? strictEqual;
    const _maybePersist = (v)=>{
        if (options?.persist) {
            try {
                options.persist(v);
            } catch (e) {
                if (options.onPersistError) {
                    options.onPersistError(e);
                } else {
                    console.warn("Store persistence failed:", e);
                }
            }
        }
    };
    const _handleInitialSubscriberError = (e)=>{
        const err = e instanceof Error ? e : new Error(String(e));
        if (options?.onError) {
            options.onError(err, "change", false);
        } else {
            console.error(`Error in subscriber for topic "change":`, err);
        }
    };
    const _pubsub = createPubSub(options?.onError ? {
        onError: (e, topic, isWildcard)=>options.onError(e, topic, isWildcard)
    } : undefined);
    let _value = initial;
    if (options?.eagerPersist !== false) {
        _maybePersist(_value);
    }
    const get = ()=>_value;
    let _notifying = false;
    let _hasPending = false;
    let _pendingValue;
    const _applyChange = (value)=>{
        _value = value;
        _maybePersist(_value);
        _pubsub.publish("change", _value);
    };
    const set = (value)=>{
        if (_equal(_value, value)) return;
        if (_notifying) {
            _hasPending = true;
            _pendingValue = value;
            return;
        }
        _notifying = true;
        try {
            _applyChange(value);
            while(_hasPending){
                const next = _pendingValue;
                _hasPending = false;
                if (!_equal(_value, next)) _applyChange(next);
            }
        } finally{
            _notifying = false;
            _hasPending = false;
        }
    };
    const update = (cb)=>{
        assertFn(cb, "[update]");
        set(cb(get()));
    };
    const subscribe = (cb)=>{
        assertFn(cb, "[subscribe]");
        try {
            cb(_value);
        } catch (e) {
            _handleInitialSubscriberError(e);
        }
        return _pubsub.subscribe("change", cb);
    };
    return {
        set,
        get,
        update,
        subscribe
    };
}
new Map();
const MicPermsErrorCode = {
    CheckFailed: "CHECK_FAILED",
    RequestFailed: "REQUEST_FAILED",
    NoDevice: "NO_DEVICE",
    InsecureContext: "INSECURE_CONTEXT",
    DeviceBusy: "DEVICE_BUSY"
};
const DEFAULT_LOGGER = createClog("micperms");
function createDefaultAdapter() {
    function supportsPermissionsApi() {
        return typeof navigator !== "undefined" && typeof navigator.permissions?.query === "function";
    }
    async function queryPermission() {
        try {
            if (!supportsPermissionsApi()) return null;
            const result = await navigator.permissions.query({
                name: "microphone"
            });
            return result.state;
        } catch  {
            return null;
        }
    }
    async function requestPermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: true
            });
            stream.getTracks().forEach((t)=>t.stop());
            return "granted";
        } catch (e) {
            if (e instanceof DOMException) {
                const name = e.name;
                if (name === "NotAllowedError" || name === "PermissionDeniedError") {
                    return "denied";
                }
            }
            throw e;
        }
    }
    function onPermissionChange(cb) {
        if (!supportsPermissionsApi()) return null;
        let permStatus = null;
        let canceled = false;
        const handler = ()=>{
            if (canceled || !permStatus) return;
            cb(permStatus.state);
        };
        navigator.permissions.query({
            name: "microphone"
        }).then((result)=>{
            if (canceled) {
                result.onchange = null;
                return;
            }
            permStatus = result;
            result.onchange = handler;
        }).catch(()=>{});
        return ()=>{
            canceled = true;
            if (permStatus) permStatus.onchange = null;
        };
    }
    return {
        queryPermission,
        requestPermission,
        supportsPermissionsApi,
        onPermissionChange
    };
}
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
function detectBridge(platform, config) {
    const iosBridgeHandler = config.iosBridgeHandler ?? "openAppSettings";
    const androidBridgeObject = config.androidBridgeObject ?? "Android";
    const androidBridgeMethod = config.androidBridgeMethod ?? "openAppSettings";
    try {
        if (platform === "ios-webview") {
            return !!_g.webkit?.messageHandlers?.[iosBridgeHandler];
        }
        if (platform === "android-webview") {
            return typeof _g[androidBridgeObject]?.[androidBridgeMethod] === "function";
        }
    } catch  {}
    return false;
}
function classifyRequestError(e) {
    if (e instanceof DOMException) {
        const name = e.name;
        if (name === "NotFoundError" || name === "DevicesNotFoundError") {
            return MicPermsErrorCode.NoDevice;
        }
        if (name === "SecurityError") {
            return MicPermsErrorCode.InsecureContext;
        }
        if (name === "NotReadableError" || name === "TrackStartError") {
            return MicPermsErrorCode.DeviceBusy;
        }
    }
    return MicPermsErrorCode.RequestFailed;
}
function createMicPerms(config) {
    const cfg = {
        ...config
    };
    const iosBridgeHandler = cfg.iosBridgeHandler ?? "openAppSettings";
    const androidBridgeObject = cfg.androidBridgeObject ?? "Android";
    const androidBridgeMethod = cfg.androidBridgeMethod ?? "openAppSettings";
    const appResumedEvent = cfg.appResumedEvent ?? "app-resumed";
    const log = cfg.logger ?? DEFAULT_LOGGER;
    const platform = detectPlatform(cfg);
    const adapter = cfg.adapter ?? createDefaultAdapter();
    const canOpenSettings = detectBridge(platform, cfg);
    const store = createStore({
        status: "unknown",
        platform,
        canOpenSettings,
        busy: false,
        observedDenied: false,
        error: null,
        lastCheckedAt: null
    });
    let destroyed = false;
    const cleanups = [];
    let inFlightCheck = null;
    let inFlightRequest = null;
    function setObservedDenied(value) {
        if (store.get().observedDenied === value) return;
        store.update((s)=>({
                ...s,
                observedDenied: value
            }));
    }
    function observeStatus(status) {
        if (status === "granted") setObservedDenied(false);
        else if (status === "denied") setObservedDenied(true);
    }
    function coerceStatus(incoming) {
        if (store.get().observedDenied && (incoming === "prompt" || incoming === "unknown")) {
            return "denied";
        }
        return incoming;
    }
    const permCleanup = adapter.onPermissionChange((status)=>{
        if (destroyed) return;
        observeStatus(status);
        const reconciled = coerceStatus(status);
        store.update((s)=>({
                ...s,
                status: reconciled,
                lastCheckedAt: Date.now()
            }));
    });
    if (permCleanup) cleanups.push(permCleanup);
    function shouldSkipPassive() {
        const last = store.get().lastCheckedAt ?? 0;
        return Date.now() - last < 500;
    }
    if (typeof _g.addEventListener === "function") {
        const handleAppResumed = ()=>{
            if (destroyed || shouldSkipPassive()) return;
            check();
        };
        _g.addEventListener(appResumedEvent, handleAppResumed);
        cleanups.push(()=>_g.removeEventListener(appResumedEvent, handleAppResumed));
        const handlePageshow = (e)=>{
            if (destroyed) return;
            if (!e.persisted) return;
            if (shouldSkipPassive()) return;
            check();
        };
        _g.addEventListener("pageshow", handlePageshow);
        cleanups.push(()=>_g.removeEventListener("pageshow", handlePageshow));
    }
    if (typeof _g.document !== "undefined") {
        const handleVisibility = ()=>{
            if (destroyed) return;
            if (_g.document.visibilityState !== "visible") return;
            if (shouldSkipPassive()) return;
            check();
        };
        _g.document.addEventListener("visibilitychange", handleVisibility);
        cleanups.push(()=>_g.document.removeEventListener("visibilitychange", handleVisibility));
    }
    async function check() {
        if (destroyed) {
            log.warn("micperms: check() called after destroy() — no-op");
            return store.get().status;
        }
        if (inFlightCheck) return inFlightCheck;
        inFlightCheck = (async ()=>{
            store.update((s)=>({
                    ...s,
                    busy: true,
                    error: null
                }));
            try {
                const result = await adapter.queryPermission();
                if (result !== null) observeStatus(result);
                const status = result === null ? store.get().status : coerceStatus(result);
                store.update((s)=>({
                        ...s,
                        status,
                        busy: false,
                        lastCheckedAt: result === null ? s.lastCheckedAt : Date.now()
                    }));
                return status;
            } catch (e) {
                const message = e instanceof Error ? e.message : "Permission check failed";
                log.error("micperms check failed", e);
                store.update((s)=>({
                        ...s,
                        busy: false,
                        error: {
                            code: MicPermsErrorCode.CheckFailed,
                            message
                        }
                    }));
                return store.get().status;
            } finally{
                inFlightCheck = null;
            }
        })();
        return inFlightCheck;
    }
    async function request() {
        if (destroyed) {
            log.warn("micperms: request() called after destroy() — no-op");
            return store.get().status;
        }
        if (inFlightRequest) return inFlightRequest;
        inFlightRequest = (async ()=>{
            store.update((s)=>({
                    ...s,
                    busy: true,
                    error: null
                }));
            try {
                const result = await adapter.requestPermission();
                observeStatus(result);
                const status = coerceStatus(result);
                store.update((s)=>({
                        ...s,
                        status,
                        busy: false,
                        lastCheckedAt: Date.now()
                    }));
                return status;
            } catch (e) {
                const code = classifyRequestError(e);
                const message = e instanceof Error ? e.message : "Permission request failed";
                log.error("micperms request failed", e);
                store.update((s)=>({
                        ...s,
                        busy: false,
                        error: {
                            code,
                            message
                        }
                    }));
                return store.get().status;
            } finally{
                inFlightRequest = null;
            }
        })();
        return inFlightRequest;
    }
    function openSettings() {
        if (!canOpenSettings) return false;
        try {
            if (platform === "ios-webview") {
                _g.webkit.messageHandlers[iosBridgeHandler].postMessage({});
                setObservedDenied(false);
                return true;
            }
            if (platform === "android-webview") {
                _g[androidBridgeObject][androidBridgeMethod]();
                setObservedDenied(false);
                return true;
            }
        } catch (e) {
            log.error("micperms openSettings failed", e);
        }
        return false;
    }
    async function recheck() {
        const status = await check();
        if (status === "unknown" || status === "prompt") {
            return await request();
        }
        return status;
    }
    function reset() {
        if (destroyed) return;
        store.update((s)=>({
                ...s,
                status: "unknown",
                observedDenied: false,
                error: null,
                lastCheckedAt: null
            }));
    }
    function destroy() {
        if (destroyed) return;
        destroyed = true;
        cleanups.forEach((fn)=>fn());
        cleanups.length = 0;
    }
    return {
        subscribe: store.subscribe.bind(store),
        get: store.get.bind(store),
        check,
        request,
        openSettings,
        recheck,
        reset,
        destroy
    };
}
export { MicPermsErrorCode as MicPermsErrorCode };
export { createDefaultAdapter as createDefaultAdapter };
export { detectPlatform as detectPlatform };
export { detectBridge as detectBridge };
export { createMicPerms as createMicPerms };
