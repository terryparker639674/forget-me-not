/**
 * License: zlib/libpng
 * @author Santo Pfingsten
 * @see https://github.com/Lusito/forget-me-not
 */

import { settings } from "./lib/settings";
import { on, byId, createElement, removeAllChildren, translateChildren, makeLinkOpenAsTab, connectHighlighters } from "./lib/htmlUtils";
import { isFirefox, browserInfo } from "./lib/browserInfo";
import { connectSettings, permanentDisableSettings, updateFromSettings } from "./lib/htmlSettings";
import { messageUtil } from "./lib/messageUtil";
import { loadJSONFile, saveJSONFile } from "./lib/fileHelper";
import * as dialogs from "./lib/dialogs";
import { CookieDomainInfo, getValidHostname } from "./shared";
import { RuleListItem, setupRuleSelect, classNameForRuleType } from "./ruleListItem";
import { browser } from "webextension-polyfill-ts";
import { TabSupport } from "./lib/tabSupport";
import * as punycode from "punycode";
import { RuleList, recreateRuleListItems } from "./ruleList";
import { wetLayer } from "wet-layer";

const removeLocalStorageByHostname = isFirefox && browserInfo.versionAsNumber >= 58;

class Popup {
    // @ts-ignore
    private readonly ruleList: RuleList;
    private hostname?: string;
    private matchingRulesListItems: RuleListItem[] = [];
    private readonly mainTabSupport = new TabSupport(byId("mainTabContainer") as HTMLElement, this.onTabChange.bind(this));
    public constructor() {
        if (browserInfo.mobile)
            (document.querySelector("html") as HTMLHtmlElement).className = "fullscreen";
        else if (window.innerWidth <= 350)
            (document.querySelector("html") as HTMLHtmlElement).className = "smallSize";

        const fallbackRuleSelect = document.querySelector("#fallbackRule") as HTMLSelectElement;
        setupRuleSelect(fallbackRuleSelect, settings.get("fallbackRule"));
        on(fallbackRuleSelect, "change", () => {
            settings.set("fallbackRule", parseInt(fallbackRuleSelect.value));
            settings.save();
        });

        connectSettings(document.body);
        if (!removeLocalStorageByHostname) {
            permanentDisableSettings([
                "cleanAll.localStorage.applyRules",
                "domainLeave.localStorage",
                "startup.localStorage.applyRules"
            ], true);
        }

        const initialTab = settings.get("initialTab");
        if (!initialTab || initialTab === "last_active_tab")
            this.mainTabSupport.setTab(settings.get("lastTab"));
        else
            this.mainTabSupport.setTab(initialTab);

        this.initCurrentTab();
        this.initSnoozeButton();

        on(byId("clean_all_now") as HTMLElement, "click", () => messageUtil.send("cleanAllNow"));

        this.ruleList = new RuleList("rules_input", "rules_list", "rules_hint", "rules_add");
        on(byId("settings_import") as HTMLElement, "click", this.onImport.bind(this));
        on(byId("settings_export") as HTMLElement, "click", this.onExport.bind(this));
        on(byId("settings_reset") as HTMLElement, "click", this.onReset.bind(this));
        const links = document.querySelectorAll("a.open_as_tab");
        for (const link of links)
            makeLinkOpenAsTab(link as HTMLAnchorElement);

        translateChildren(document);
        [...document.body.querySelectorAll("input[placeholder]")].forEach((e) => e.setAttribute("aria-label", e.getAttribute("placeholder") || ""));
        messageUtil.receive("settingsChanged", (changedKeys: string[]) => {
            if (changedKeys.length > 1 || changedKeys.indexOf("domainsToClean") === -1)
                updateFromSettings();
            if (changedKeys.indexOf("rules") !== -1)
                this.rebuildMatchingRulesList();
            if (changedKeys.indexOf("fallbackRule") !== -1)
                fallbackRuleSelect.className = classNameForRuleType(settings.get("fallbackRule"));
        });

        const recentlyAccessedDomainsList = byId("recently_accessed_domains") as HTMLElement;
        messageUtil.receive("onRecentlyAccessedDomains", (domains: CookieDomainInfo[]) => {
            removeAllChildren(recentlyAccessedDomainsList);
            for (const info of domains) {
                const li = createElement(document, recentlyAccessedDomainsList, "li");
                createElement(document, li, "span", { textContent: wetLayer.getMessage(info.badge), className: info.badge });
                const punified = this.appendPunycode(info.domain);
                createElement(document, li, "span", { textContent: punified, title: punified });
                const addRuleMessage = wetLayer.getMessage("button_log_add_rule");
                const addRule = createElement(document, li, "button", { textContent: addRuleMessage, className: "log_add_rule" });
                addRule.setAttribute("tabindex", "0");
                addRule.setAttribute("aria-label", `${addRuleMessage} (${punified})`);
                on(addRule, "click", () => this.prepareAddRule(info.domain));
            }
        });

        messageUtil.send("getRecentlyAccessedDomains");
        connectHighlighters();

        wetLayer.addListener(() => {
            translateChildren(document);
            messageUtil.send("getRecentlyAccessedDomains");
            this.setCurrentTabLabel(this.hostname || false);
            messageUtil.send("getSnoozingState");
        });
        wetLayer.loadFromStorage();
    }

    private appendPunycode(domain: string) {
        const punified = punycode.toUnicode(domain);
        return (punified === domain) ? domain : `${domain} (${punified})`;
    }

    private onTabChange(name: string) {
        settings.set("lastTab", name);
        settings.save();
    }

    private prepareAddRule(domain: string) {
        this.mainTabSupport.setTab("rules");
        this.ruleList.setInput("*." + domain.trim().toLowerCase());
    }

    private setCurrentTabLabel(domain: string | false) {
        const label = byId("current_tab");
        if (label)
            label.textContent = domain ? domain : wetLayer.getMessage("invalid_tab");
        const labelPunnified = byId("current_tab_punyfied");
        if (labelPunnified) {
            let punnified = "";
            if (domain) {
                punnified = domain ? punycode.toUnicode(domain) : "";
                punnified = (punnified === domain) ? "" : `(${punnified})`;
            }
            labelPunnified.textContent = punnified;
        }
    }

    private setInvalidTab() {
        this.setCurrentTabLabel(false);
        const cleanCurrentTab = byId("clean_current_tab");
        if (cleanCurrentTab)
            cleanCurrentTab.style.display = "none";
        if (this.mainTabSupport.getTab() === "this_tab")
            this.mainTabSupport.setTab("clean_all");
    }

    private initCurrentTab() {
        browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
            const tab = tabs.length && tabs[0];
            if (tab && tab.url && !tab.incognito) {
                const hostname = getValidHostname(tab.url);
                const cleanCurrentTab = byId("clean_current_tab");
                if (!hostname) {
                    this.setInvalidTab();
                } else {
                    this.hostname = hostname;
                    this.setCurrentTabLabel(hostname);
                    if (cleanCurrentTab) {
                        on(cleanCurrentTab, "click", () => {
                            messageUtil.send("cleanUrlNow", { hostname: this.hostname, cookieStoreId: tab.cookieStoreId });
                        });
                    }
                    const addRule = byId("current_tab_add_rule");
                    if (addRule) {
                        on(addRule, "click", () => this.prepareAddRule(hostname));
                        addRule.setAttribute("aria-label", `${addRule.textContent} (${hostname})`);
                    }
                    this.rebuildMatchingRulesList();
                }
            } else {
                this.setInvalidTab();
            }
        });
    }

    private initSnoozeButton() {
        const toggleSnooze = byId("toggle_snooze") as HTMLButtonElement;
        toggleSnooze.disabled = true;
        on(toggleSnooze, "click", () => {
            toggleSnooze.disabled = true;
            messageUtil.send("toggleSnoozingState");
        });
        messageUtil.receive("onSnoozingState", (snoozing: boolean) => {
            toggleSnooze.disabled = false;
            toggleSnooze.textContent = wetLayer.getMessage("button_toggle_snooze_" + snoozing);
        });
        messageUtil.send("getSnoozingState");
    }

    private onImport() {
        // desktop firefox closes popup when dialog is shown
        if (isFirefox && !browserInfo.mobile) {
            browser.tabs.create({
                url: browser.runtime.getURL("views/import.html"),
                active: true
            });
            window.close();
        } else {
            loadJSONFile((json) => {
                if (json && settings.setAll(json)) {
                    console.log("success");
                }
            });
        }
    }

    private onExport() {
        const exported = settings.getAll();
        delete exported.domainsToClean;
        saveJSONFile(exported, "forget-me-not-settings.json");
    }

    private onReset() {
        const dialog = dialogs.createDialog("confirm", "reset_dialog_title", {
            confirm_settings_and_rules: () => {
                dialog.close();
                settings.setAll({
                    domainsToClean: settings.get("domainsToClean")
                });
            },
            confirm_settings_only: () => {
                dialog.close();
                settings.setAll({
                    domainsToClean: settings.get("domainsToClean"),
                    rules: settings.get("rules"),
                    fallbackRule: settings.get("fallbackRule"),
                    whitelistNoTLD: settings.get("whitelistNoTLD"),
                    whitelistFileSystem: settings.get("whitelistFileSystem")
                });
            },
            confirm_cancel: () => {
                dialog.close();
            }
        });
        dialog.contentNode.setAttribute("data-i18n", "reset_dialog_content");
        dialog.buttonNodes.confirm_settings_only.focus();
        translateChildren(dialog.domNode);
    }

    private rebuildMatchingRulesList() {
        if (this.hostname) {
            const matchingRules = settings.getMatchingRules(this.hostname);
            const list = byId("rules_list_current_tab") as HTMLElement;
            this.matchingRulesListItems = recreateRuleListItems(this.matchingRulesListItems, matchingRules, list);
        }
    }
}

settings.onReady(() => new Popup());
