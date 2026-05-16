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
	export class AppSettings {
	    schemaVersion: number;
	    theme: string;
	    startup: string;
	    autoRefreshRegistry: boolean;
	    autoInstallDefaults: boolean;
	    telemetryOptIn: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AppSettings(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schemaVersion = source["schemaVersion"];
	        this.theme = source["theme"];
	        this.startup = source["startup"];
	        this.autoRefreshRegistry = source["autoRefreshRegistry"];
	        this.autoInstallDefaults = source["autoInstallDefaults"];
	        this.telemetryOptIn = source["telemetryOptIn"];
	    }
	}
	export class BrowseFilter {
	    type?: string;
	    query?: string;
	    tags?: string[];
	
	    static createFrom(source: any = {}) {
	        return new BrowseFilter(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.query = source["query"];
	        this.tags = source["tags"];
	    }
	}
	export class Build {
	    ID: string;
	    RecipeID: string;
	    DisplayName: string;
	    SourceRepo: string;
	    Commit: string;
	    Backend: string;
	    BinaryPath: string;
	    Capabilities: string[];
	    // Go type: time
	    BuiltAt: any;
	
	    static createFrom(source: any = {}) {
	        return new Build(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.RecipeID = source["RecipeID"];
	        this.DisplayName = source["DisplayName"];
	        this.SourceRepo = source["SourceRepo"];
	        this.Commit = source["Commit"];
	        this.Backend = source["Backend"];
	        this.BinaryPath = source["BinaryPath"];
	        this.Capabilities = source["Capabilities"];
	        this.BuiltAt = this.convertValues(source["BuiltAt"], null);
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
	export class BuildRecipe {
	    ID: string;
	    DisplayName: string;
	    SourceDir: string;
	    SourceRepo: string;
	    GitRef: string;
	    Backend: string;
	    CMakeFlags: string[];
	    BuildDir: string;
	    Jobs: number;
	    // Go type: time
	    CreatedAt: any;
	    // Go type: time
	    UpdatedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new BuildRecipe(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ID = source["ID"];
	        this.DisplayName = source["DisplayName"];
	        this.SourceDir = source["SourceDir"];
	        this.SourceRepo = source["SourceRepo"];
	        this.GitRef = source["GitRef"];
	        this.Backend = source["Backend"];
	        this.CMakeFlags = source["CMakeFlags"];
	        this.BuildDir = source["BuildDir"];
	        this.Jobs = source["Jobs"];
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
	export class BuildStatus {
	    recipeId: string;
	    phase: string;
	    running: boolean;
	    message?: string;
	    buildId?: string;
	    // Go type: time
	    startedAt?: any;
	
	    static createFrom(source: any = {}) {
	        return new BuildStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.recipeId = source["recipeId"];
	        this.phase = source["phase"];
	        this.running = source["running"];
	        this.message = source["message"];
	        this.buildId = source["buildId"];
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
	export class Capabilities {
	    vision: boolean;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new Capabilities(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.vision = source["vision"];
	        this.source = source["source"];
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
	export class DetectedGPU {
	    vendor: string;
	    name: string;
	    vramMib: number;
	    source: string;
	    backend: string;
	
	    static createFrom(source: any = {}) {
	        return new DetectedGPU(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.vendor = source["vendor"];
	        this.name = source["name"];
	        this.vramMib = source["vramMib"];
	        this.source = source["source"];
	        this.backend = source["backend"];
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
	export class SamplingDefaults {
	    temperature?: number;
	    topP?: number;
	    topK?: number;
	    minP?: number;
	    repeatPenalty?: number;
	
	    static createFrom(source: any = {}) {
	        return new SamplingDefaults(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.temperature = source["temperature"];
	        this.topP = source["topP"];
	        this.topK = source["topK"];
	        this.minP = source["minP"];
	        this.repeatPenalty = source["repeatPenalty"];
	    }
	}
	export class Family {
	    id: string;
	    name: string;
	    description?: string;
	    chatTemplateHint?: string;
	    reasoningToken?: string;
	    samplingDefaults: SamplingDefaults;
	    notes?: string;
	    source: string;
	
	    static createFrom(source: any = {}) {
	        return new Family(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.chatTemplateHint = source["chatTemplateHint"];
	        this.reasoningToken = source["reasoningToken"];
	        this.samplingDefaults = this.convertValues(source["samplingDefaults"], SamplingDefaults);
	        this.notes = source["notes"];
	        this.source = source["source"];
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
	export class FamilyGuess {
	    family: string;
	    familyVersion: string;
	    architecture: string;
	    name: string;
	
	    static createFrom(source: any = {}) {
	        return new FamilyGuess(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.family = source["family"];
	        this.familyVersion = source["familyVersion"];
	        this.architecture = source["architecture"];
	        this.name = source["name"];
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
	export class GPUDetection {
	    gpus: DetectedGPU[];
	    probed: string[];
	    available: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GPUDetection(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.gpus = this.convertValues(source["gpus"], DetectedGPU);
	        this.probed = source["probed"];
	        this.available = source["available"];
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
	export class InstalledArtifact {
	    type: string;
	    id: string;
	    version: string;
	    sourceId: string;
	    files: string[];
	    sha256?: string;
	    // Go type: time
	    installedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new InstalledArtifact(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.id = source["id"];
	        this.version = source["version"];
	        this.sourceId = source["sourceId"];
	        this.files = source["files"];
	        this.sha256 = source["sha256"];
	        this.installedAt = this.convertValues(source["installedAt"], null);
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
	    caps: Capabilities;
	
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
	        this.caps = this.convertValues(source["caps"], Capabilities);
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
	export class ModeParam {
	    name: string;
	    type: string;
	    default?: any;
	    required?: boolean;
	    description?: string;
	
	    static createFrom(source: any = {}) {
	        return new ModeParam(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	        this.default = source["default"];
	        this.required = source["required"];
	        this.description = source["description"];
	    }
	}
	export class Mode {
	    id: string;
	    name: string;
	    color: string;
	    source: string;
	    desc: string;
	    plugin?: string;
	    systemPromptTemplate?: string;
	    systemPrompt?: string;
	    params?: ModeParam[];
	    toolWhitelist?: string[];
	    approval?: string;
	    context?: string;
	    recommendedFor?: string[];
	
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
	        this.systemPromptTemplate = source["systemPromptTemplate"];
	        this.systemPrompt = source["systemPrompt"];
	        this.params = this.convertValues(source["params"], ModeParam);
	        this.toolWhitelist = source["toolWhitelist"];
	        this.approval = source["approval"];
	        this.context = source["context"];
	        this.recommendedFor = source["recommendedFor"];
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
	    BuildID: string;
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
	    Family: string;
	    FamilyVersion: string;
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
	        this.BuildID = source["BuildID"];
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
	        this.Family = source["Family"];
	        this.FamilyVersion = source["FamilyVersion"];
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
	export class RegistryFile {
	    path: string;
	    url: string;
	
	    static createFrom(source: any = {}) {
	        return new RegistryFile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.url = source["url"];
	    }
	}
	export class RegistryArtifact {
	    type: string;
	    id: string;
	    version: string;
	    sha256?: string;
	    files: RegistryFile[];
	    description?: string;
	    tags?: string[];
	    recommended_for?: string[];
	    author?: string;
	    preview?: string;
	    default_install?: boolean;
	    source?: string;
	    sourceName?: string;
	
	    static createFrom(source: any = {}) {
	        return new RegistryArtifact(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.id = source["id"];
	        this.version = source["version"];
	        this.sha256 = source["sha256"];
	        this.files = this.convertValues(source["files"], RegistryFile);
	        this.description = source["description"];
	        this.tags = source["tags"];
	        this.recommended_for = source["recommended_for"];
	        this.author = source["author"];
	        this.preview = source["preview"];
	        this.default_install = source["default_install"];
	        this.source = source["source"];
	        this.sourceName = source["sourceName"];
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
	
	export class RegistryIndex {
	    schema_version: number;
	    updated_at?: string;
	    artifacts: RegistryArtifact[];
	
	    static createFrom(source: any = {}) {
	        return new RegistryIndex(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.schema_version = source["schema_version"];
	        this.updated_at = source["updated_at"];
	        this.artifacts = this.convertValues(source["artifacts"], RegistryArtifact);
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
	export class RegistrySource {
	    id: string;
	    name: string;
	    url: string;
	    autoRefresh: boolean;
	    // Go type: time
	    addedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new RegistrySource(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.url = source["url"];
	        this.autoRefresh = source["autoRefresh"];
	        this.addedAt = this.convertValues(source["addedAt"], null);
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
	    params?: Record<string, any>;
	
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
	        this.params = source["params"];
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
	export class SourceDirInfo {
	    path: string;
	    exists: boolean;
	    isGitRepo: boolean;
	    gitRemote: string;
	    configuredBuildDir: string;
	    cmakeFlags: string[];
	    backend: string;
	
	    static createFrom(source: any = {}) {
	        return new SourceDirInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.path = source["path"];
	        this.exists = source["exists"];
	        this.isGitRepo = source["isGitRepo"];
	        this.gitRemote = source["gitRemote"];
	        this.configuredBuildDir = source["configuredBuildDir"];
	        this.cmakeFlags = source["cmakeFlags"];
	        this.backend = source["backend"];
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

