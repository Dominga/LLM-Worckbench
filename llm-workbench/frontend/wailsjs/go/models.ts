export namespace main {
	
	export class AgentSnapshot {
	    sha: string;
	    streamId?: string;
	    modeId: string;
	    message: string;
	    // Go type: time
	    ts: any;
	    reverted?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AgentSnapshot(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sha = source["sha"];
	        this.streamId = source["streamId"];
	        this.modeId = source["modeId"];
	        this.message = source["message"];
	        this.ts = this.convertValues(source["ts"], null);
	        this.reverted = source["reverted"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ChatMessage {
	    role: string;
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new ChatMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.content = source["content"];
	    }
	}
	export class ChunkHit {
	    chunkId: number;
	    path: string;
	    startByte: number;
	    endByte: number;
	    content: string;
	    score: number;
	    denseRank: number;
	    sparseRank: number;
	    denseDist?: number;
	    sparseBm25?: number;
	
	    static createFrom(source: any = {}) {
	        return new ChunkHit(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.chunkId = source["chunkId"];
	        this.path = source["path"];
	        this.startByte = source["startByte"];
	        this.endByte = source["endByte"];
	        this.content = source["content"];
	        this.score = source["score"];
	        this.denseRank = source["denseRank"];
	        this.sparseRank = source["sparseRank"];
	        this.denseDist = source["denseDist"];
	        this.sparseBm25 = source["sparseBm25"];
	    }
	}
	export class EmbeddingProgress {
	    chunksTotal: number;
	    chunksEmbedded: number;
	    batchesSent: number;
	    embedDim: number;
	    embedModelId: string;
	    durationMs: number;
	    errors?: string[];
	
	    static createFrom(source: any = {}) {
	        return new EmbeddingProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.chunksTotal = source["chunksTotal"];
	        this.chunksEmbedded = source["chunksEmbedded"];
	        this.batchesSent = source["batchesSent"];
	        this.embedDim = source["embedDim"];
	        this.embedModelId = source["embedModelId"];
	        this.durationMs = source["durationMs"];
	        this.errors = source["errors"];
	    }
	}
	export class FileContent {
	    path: string;
	    bytes: number;
	    content: string;
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new FileContent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.bytes = source["bytes"];
	        this.content = source["content"];
	        this.truncated = source["truncated"];
	    }
	}
	export class FileNode {
	    name: string;
	    path: string;
	    isDir: boolean;
	    size: number;
	    // Go type: time
	    modified: any;
	    children?: FileNode[];
	
	    static createFrom(source: any = {}) {
	        return new FileNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.isDir = source["isDir"];
	        this.size = source["size"];
	        this.modified = this.convertValues(source["modified"], null);
	        this.children = this.convertValues(source["children"], FileNode);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class GPUInfo {
	    index: number;
	    name: string;
	    usedMb: number;
	    totalMb: number;
	    vendor: string;
	
	    static createFrom(source: any = {}) {
	        return new GPUInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.index = source["index"];
	        this.name = source["name"];
	        this.usedMb = source["usedMb"];
	        this.totalMb = source["totalMb"];
	        this.vendor = source["vendor"];
	    }
	}
	export class GPUMetrics {
	    available: boolean;
	    gpus: GPUInfo[];
	    usedMb: number;
	    totalMb: number;
	
	    static createFrom(source: any = {}) {
	        return new GPUMetrics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.gpus = this.convertValues(source["gpus"], GPUInfo);
	        this.usedMb = source["usedMb"];
	        this.totalMb = source["totalMb"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class IndexProgress {
	    filesProcessed: number;
	    filesSkipped: number;
	    chunksAdded: number;
	    chunksRemoved: number;
	    filesRemoved: number;
	    errors?: string[];
	    durationMs: number;
	
	    static createFrom(source: any = {}) {
	        return new IndexProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filesProcessed = source["filesProcessed"];
	        this.filesSkipped = source["filesSkipped"];
	        this.chunksAdded = source["chunksAdded"];
	        this.chunksRemoved = source["chunksRemoved"];
	        this.filesRemoved = source["filesRemoved"];
	        this.errors = source["errors"];
	        this.durationMs = source["durationMs"];
	    }
	}
	export class IndexStats {
	    projectId: string;
	    path: string;
	    chunkCount: number;
	    embedModelId: string;
	    embedDim: number;
	    schemaVer: number;
	
	    static createFrom(source: any = {}) {
	        return new IndexStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.projectId = source["projectId"];
	        this.path = source["path"];
	        this.chunkCount = source["chunkCount"];
	        this.embedModelId = source["embedModelId"];
	        this.embedDim = source["embedDim"];
	        this.schemaVer = source["schemaVer"];
	    }
	}
	export class InitialDoc {
	    path: string;
	    content: string;
	    bytes: number;
	    loadedMs: number;
	
	    static createFrom(source: any = {}) {
	        return new InitialDoc(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.content = source["content"];
	        this.bytes = source["bytes"];
	        this.loadedMs = source["loadedMs"];
	    }
	}
	export class InstanceMetrics {
	    profileId: string;
	    lastTps: number;
	    tpsSpark: number[];
	    reqs: number;
	
	    static createFrom(source: any = {}) {
	        return new InstanceMetrics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.lastTps = source["lastTps"];
	        this.tpsSpark = source["tpsSpark"];
	        this.reqs = source["reqs"];
	    }
	}
	export class InstanceStatus {
	    profileId: string;
	    state: string;
	    running: boolean;
	    healthy: boolean;
	    pid: number;
	    baseUrl: string;
	    uptimeSec: number;
	    // Go type: time
	    startedAt?: any;
	
	    static createFrom(source: any = {}) {
	        return new InstanceStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.profileId = source["profileId"];
	        this.state = source["state"];
	        this.running = source["running"];
	        this.healthy = source["healthy"];
	        this.pid = source["pid"];
	        this.baseUrl = source["baseUrl"];
	        this.uptimeSec = source["uptimeSec"];
	        this.startedAt = this.convertValues(source["startedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Mode {
	    id: string;
	    name: string;
	    color: string;
	    source: string;
	    desc: string;
	    plugin?: string;
	    systemPrompt?: string;
	    toolWhitelist?: string[];
	    approval?: string;
	    context?: string;
	
	    static createFrom(source: any = {}) {
	        return new Mode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.color = source["color"];
	        this.source = source["source"];
	        this.desc = source["desc"];
	        this.plugin = source["plugin"];
	        this.systemPrompt = source["systemPrompt"];
	        this.toolWhitelist = source["toolWhitelist"];
	        this.approval = source["approval"];
	        this.context = source["context"];
	    }
	}
	export class Sampling {
	    Temperature: number;
	    TopP: number;
	    MinP: number;
	    RepeatPenalty: number;
	
	    static createFrom(source: any = {}) {
	        return new Sampling(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.Temperature = source["Temperature"];
	        this.TopP = source["TopP"];
	        this.MinP = source["MinP"];
	        this.RepeatPenalty = source["RepeatPenalty"];
	    }
	}
	export class Profile {
	    ID: string;
	    Kind: string;
	    BinPath: string;
	    BinCwd: string;
	    ModelPath: string;
	    MMProjPath: string;
	    LaunchEmbedding: boolean;
	    EmbedProfileID: string;
	    Host: string;
	    Port: number;
	    CtxSize: number;
	    NGL: number;
	    ExtraArgs: string[];
	    Sampling: Sampling;
	    Autostart: boolean;
	    HealthTimeoutSec: number;
	    ToolMode: string;
	    // Go type: time
	    CreatedAt: any;
	    // Go type: time
	    UpdatedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new Profile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.Kind = source["Kind"];
	        this.BinPath = source["BinPath"];
	        this.BinCwd = source["BinCwd"];
	        this.ModelPath = source["ModelPath"];
	        this.MMProjPath = source["MMProjPath"];
	        this.LaunchEmbedding = source["LaunchEmbedding"];
	        this.EmbedProfileID = source["EmbedProfileID"];
	        this.Host = source["Host"];
	        this.Port = source["Port"];
	        this.CtxSize = source["CtxSize"];
	        this.NGL = source["NGL"];
	        this.ExtraArgs = source["ExtraArgs"];
	        this.Sampling = this.convertValues(source["Sampling"], Sampling);
	        this.Autostart = source["Autostart"];
	        this.HealthTimeoutSec = source["HealthTimeoutSec"];
	        this.ToolMode = source["ToolMode"];
	        this.CreatedAt = this.convertValues(source["CreatedAt"], null);
	        this.UpdatedAt = this.convertValues(source["UpdatedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Project {
	    ID: string;
	    Path: string;
	    Name: string;
	    // Go type: time
	    CreatedAt: any;
	    // Go type: time
	    LastOpened: any;
	
	    static createFrom(source: any = {}) {
	        return new Project(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.Path = source["Path"];
	        this.Name = source["Name"];
	        this.CreatedAt = this.convertValues(source["CreatedAt"], null);
	        this.LastOpened = this.convertValues(source["LastOpened"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class RenderResult {
	    html: string;
	    parseMs: number;
	    bytes: number;
	    htmlSize: number;
	
	    static createFrom(source: any = {}) {
	        return new RenderResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.html = source["html"];
	        this.parseMs = source["parseMs"];
	        this.bytes = source["bytes"];
	        this.htmlSize = source["htmlSize"];
	    }
	}
	
	export class ScriptFile {
	    name: string;
	    path: string;
	    size: number;
	    // Go type: time
	    modified: any;
	
	    static createFrom(source: any = {}) {
	        return new ScriptFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.modified = this.convertValues(source["modified"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ScriptResult {
	    output: string[];
	    return?: any;
	    error?: string;
	    durationMs: number;
	
	    static createFrom(source: any = {}) {
	        return new ScriptResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.output = source["output"];
	        this.return = source["return"];
	        this.error = source["error"];
	        this.durationMs = source["durationMs"];
	    }
	}
	export class Session {
	    id: string;
	    projectId: string;
	    title: string;
	    modeId: string;
	    profileId: string;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	    messageCount: number;
	
	    static createFrom(source: any = {}) {
	        return new Session(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.projectId = source["projectId"];
	        this.title = source["title"];
	        this.modeId = source["modeId"];
	        this.profileId = source["profileId"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	        this.messageCount = source["messageCount"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SessionMessage {
	    role: string;
	    content: string;
	    // Go type: time
	    ts: any;
	    profileId?: string;
	    toolCalls?: number[];
	
	    static createFrom(source: any = {}) {
	        return new SessionMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.content = source["content"];
	        this.ts = this.convertValues(source["ts"], null);
	        this.profileId = source["profileId"];
	        this.toolCalls = source["toolCalls"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Status {
	    running: boolean;
	    pid: number;
	    baseUrl: string;
	    healthy: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Status(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.running = source["running"];
	        this.pid = source["pid"];
	        this.baseUrl = source["baseUrl"];
	        this.healthy = source["healthy"];
	    }
	}
	export class StreamHandle {
	    streamId: string;
	
	    static createFrom(source: any = {}) {
	        return new StreamHandle(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.streamId = source["streamId"];
	    }
	}
	export class SystemMetrics {
	    available: boolean;
	    totalBytes: number;
	    usedBytes: number;
	    freeBytes: number;
	
	    static createFrom(source: any = {}) {
	        return new SystemMetrics(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.available = source["available"];
	        this.totalBytes = source["totalBytes"];
	        this.usedBytes = source["usedBytes"];
	        this.freeBytes = source["freeBytes"];
	    }
	}

}

