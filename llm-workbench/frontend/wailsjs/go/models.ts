export namespace main {
	
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

}

