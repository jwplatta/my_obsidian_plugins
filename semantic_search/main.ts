import {
	App, Editor,
	MarkdownView,
	Modal, Notice, moment, Plugin,
	PluginSettingTab, Setting, SuggestModal, TextAreaComponent, ButtonComponent
} from 'obsidian';

interface OpenAISettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: OpenAISettings = {
	mySetting: 'default'
}

function getTodaysDate() {
	return moment().format("YYYY-MM-DD");
}

export default class OpenAI extends Plugin {
	statusBar: HTMLElement;
	settings: OpenAISettings;

	async onload() {
		console.log("loading plugin");
		await this.loadSettings();
	}

	async onunload() {
		console.log('unloading plugin');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}