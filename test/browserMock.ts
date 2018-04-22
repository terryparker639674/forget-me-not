/**
 * License: zlib/libpng
 * @author Santo Pfingsten
 * @see https://github.com/Lusito/forget-me-not
 */

import { browser, Tabs, WebNavigation, Runtime } from "webextension-polyfill-ts";
import { assert } from "chai";

// @ts-ignore
const Url = require('url');
const glob = (function () { return this; }()) || Function('return this')();
glob.URL = function (url: string) {
    const parsed = Url.parse(url);
    for (let key in parsed) {
        if (parsed.hasOwnProperty(key))
            this[key] = parsed[key];
    }
}

type ListenerCallback = (...args: any[]) => any;
class ListenerMock<T extends Function> {
    private listeners: ListenerCallback[] = [];
    public emit: T;
    public constructor() {
        const self = this;
        //@ts-ignore
        this.emit = function () {
            for (const listener of self.listeners) {
                listener.apply(null, arguments);
            }
        };
    }

    public get() {
        return {
            addListener: (listener: ListenerCallback) => {
                this.listeners.push(listener);
            },
            removeListener: (listener: ListenerCallback) => {
                this.listeners = this.listeners.filter((cb) => listener !== cb);
            }
        };
    }

    public reset() {
        this.listeners.length = 0;
    }
}

class BrowserTabsMock {
    private idCount = 0;
    private tabs: Tabs.Tab[] = [];
    public onRemoved = new ListenerMock<(tabId: number, removeInfo: Tabs.OnRemovedRemoveInfoType) => void>();
    public onCreated = new ListenerMock<(tab: Tabs.Tab) => void>();

    public reset() {
        this.tabs.length = 0;
        this.onRemoved.reset();
        this.onCreated.reset();
    }
    public getTabs(): Tabs.Tab[] {
        return this.tabs;
    }

    public get(tabId: number): Tabs.Tab | undefined {
        return this.tabs.find((ti) => ti.id === tabId);
    }

    public create(url: string, cookieStoreId: string) {
        const id = ++this.idCount
        const tab: Tabs.Tab = {
            active: true,
            cookieStoreId: cookieStoreId,
            highlighted: false,
            id: id,
            incognito: false,
            index: this.tabs.length,
            isArticle: false,
            isInReaderMode: false,
            lastAccessed: Date.now(),
            pinned: false,
            url: url,
            windowId: 1
        };
        this.tabs.push(tab);
        browserMock.tabs.onCreated.emit(tab);
        return id;
    }

    public remove(tabId: number) {
        let i = 0;
        while (i < this.tabs.length) {
            if (this.tabs[i].id === tabId) {
                this.onRemoved.emit(tabId, { windowId: this.tabs[i].windowId, isWindowClosing: false });
                this.tabs.splice(i, 1);
                break;
            }
            i++;
        }
        while (i < this.tabs.length)
            this.tabs[i].index = i++;
    }
}

class BrowserWebNavigationMock {
    public onBeforeNavigate = new ListenerMock<(details: WebNavigation.OnBeforeNavigateDetailsType) => void>();
    public onCommitted = new ListenerMock<(details: WebNavigation.OnCommittedDetailsType) => void>();

    public reset() {
        this.onBeforeNavigate.reset();
        this.onCommitted.reset();
    }

    public beforeNavigate(tabId: number, url: string) {
        const tab = browserMock.tabs.get(tabId);
        assert.isDefined(tab);
        if (tab) {
            this.onBeforeNavigate.emit({
                tabId,
                url,
                timeStamp: Date.now(),
                frameId: 0,
                parentFrameId: 0
            });
        }
    }

    public commit(tabId: number, url: string) {
        const tab = browserMock.tabs.get(tabId);
        assert.isDefined(tab);
        if (tab) {
            tab.url = url;
            this.onCommitted.emit({
                tabId,
                url,
                timeStamp: Date.now(),
                frameId: 0
            });
        }
    }
}

class BrowserRuntimeMock {
    public onMessage = new ListenerMock<(message: any | undefined, sender: Runtime.MessageSender, sendResponse: () => void) => void>();

    public sendMessage(message: any, options?: Runtime.SendMessageOptionsType): Promise<any> {
        return new Promise((resolve, reject) => {
            this.onMessage.emit(message, { id: 'mock' }, () => { });
            resolve();
        });
    }
}

export const browserMock = {
    tabs: new BrowserTabsMock(),
    webNavigation: new BrowserWebNavigationMock(),
    runtime: new BrowserRuntimeMock(),
    reset: () => {
        browserMock.tabs.reset();
        browserMock.webNavigation.reset();
    }
};

//@ts-ignore
browser.tabs = {
    query: () => {
        return {
            then(resolve: (tabs: Tabs.Tab[]) => void) {
                resolve(browserMock.tabs.getTabs());
            }
        };
    },
    onRemoved: browserMock.tabs.onRemoved.get(),
    onCreated: browserMock.tabs.onCreated.get()
};

//@ts-ignore
browser.webNavigation = {
    onBeforeNavigate: browserMock.webNavigation.onBeforeNavigate.get(),
    onCommitted: browserMock.webNavigation.onCommitted.get()
}

//@ts-ignore
browser.runtime = {
    onMessage: browserMock.runtime.onMessage.get(),
    sendMessage: browserMock.runtime.sendMessage.bind(browserMock.runtime)
}

export interface SpyData {
    (...args: any[]): any;
    callCount: number;
    thisValues: any[];
    args: any[][];
    assertCalls: (args: any[], thisValues?: any[]) => void;
    assertNoCall: () => void;
    reset: () => void;
}
export function createSpy() {
    const spyData = function () {
        spyData.callCount++;
        spyData.thisValues.push(this);
        spyData.args.push(Array.from(arguments));
    } as SpyData;
    spyData.callCount = 0;
    spyData.thisValues = [];
    spyData.args = [];
    spyData.assertCalls = (args, thisValues?) => {
        assert.deepEqual(spyData.args, args);
        if(thisValues)
            assert.deepEqual(spyData.thisValues, thisValues);
        spyData.reset();
    };
    spyData.assertNoCall = () => {
        assert.equal(spyData.callCount, 0);
    };

    spyData.reset = () => {
        spyData.callCount = 0;
        spyData.thisValues.length = 0;
        spyData.args.length = 0;
    }
    return spyData;
}
