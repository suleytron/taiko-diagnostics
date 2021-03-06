import speedline from 'speedline';
import TraceOfTab from './lighthouse/tabTracing'
import FirstInteractiveAudit from './lighthouse/firstInteractive'
var log = require('npmlog');
class TracingHandler {
    constructor(tracing, io) {
        this._io = io;
        this._tracing = tracing;
        this.isTracing = false;
    }

    startTracing(categories = DEFAULT_TRACING_CATEGORIES) {
        if (this.isTracing) {
            throw new Error('Browser is already being traced');
        }
        this.isTracing = true;
        this._tracing.start({ categories: categories.join(','), transferMode: 'ReturnAsStream' });
    }

    async endTracing() {
        if (!this.isTracing) {
            throw new Error('No tracing was initiated, initiate `startTracing()` first');
        }
        this._tracing.end();
        this.isTracing = false;
        let fulfill;
        this.traceEvents = new Promise(x => fulfill = x);
        await this._tracing.tracingComplete(async event => {
            await this._readIOStream(event.stream).then(fulfill);
        });
        return await this.traceEvents;
    }

    async getTracingLogs() {
        return await this.traceEvents;
    }

    async getSpeedIndex() {
        const { speedIndex, perceptualSpeedIndex } = await speedline(await this.traceEvents);
        return { speedIndex, perceptualSpeedIndex };
    }

    async getPerformanceMetrics () {
        const traces = TraceOfTab.compute(await this.traceEvents)
        const audit = new FirstInteractiveAudit()
        let timeToFirstInteract = null

        try {
            timeToFirstInteract = audit.computeWithArtifacts(traces).timeInMs
        } catch (e) {
            log.warn(`Failed to get timeToFirstInteractive due to "${e.friendlyMessage}"`)
        }

        return {
            firstPaint: traces.timings.firstPaint,
            firstContentfulPaint: traces.timings.firstContentfulPaint,
            firstMeaningfulPaint: traces.timings.firstMeaningfulPaint,
            domContentLoaded: traces.timings.domContentLoaded,
            timeToFirstInteractive: timeToFirstInteract,
            load: traces.timings.load
        }
    }

    async _readIOStream(stream) {
        let isEOF = false;
        let tracingChunks = '';

        while (!isEOF) {
            const { data, eof } = await this._io.read({ handle: stream });
            tracingChunks += data;

            if (eof) {
                isEOF = true;
                return JSON.parse(tracingChunks);
            }
        }

    }

}

const DEFAULT_TRACING_CATEGORIES = [
    // Exclude default categories. We'll be selective to minimize trace size
    '-*',

    // Used instead of 'toplevel' in Chrome 71+
    'disabled-by-default-lighthouse',

    // All compile/execute events are captured by parent events in devtools.timeline..
    // But the v8 category provides some nice context for only <0.5% of the trace size
    'v8',
    // Same situation here. This category is there for RunMicrotasks only, but with other teams
    // accidentally excluding microtasks, we don't want to assume a parent event will always exist
    'v8.execute',

    // For extracting UserTiming marks/measures
    'blink.user_timing',

    // Not mandatory but not used much
    'blink.console',

    // Most the events we need come in on these two
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',

    // Up to 450 (https://goo.gl/rBfhn4) JPGs added to the trace
    'disabled-by-default-devtools.screenshot',

    // This doesn't add its own events, but adds a `stackTrace` property to devtools.timeline events
    'disabled-by-default-devtools.timeline.stack',

    // Include screenshots for frame viewer
    'disabled-by-default-devtools.screenshot'
];

export default TracingHandler;