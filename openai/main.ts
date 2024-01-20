import {
	App,
	Modal,
	Plugin,
	PluginSettingTab,
	Setting,
	SuggestModal,
	TextAreaComponent,
	ButtonComponent,
	MarkdownView,
	TFile
} from 'obsidian';
import OpenAI from 'openai';

interface OpenAISettings {
	apiKey: string;
	model: string;
	temperature: number;
	maxTokens: number;
	topP: number;
	frequencyPenalty: number;
	presencePenalty: number;
	dataDir: string;
	dataFilePath: string;
}

interface Instruction {
	id: number;
	text: string;
	usageCount: number;
}

const DEFAULT_SETTINGS: OpenAISettings = {
	apiKey: "",
	model: "gpt-3.5-turbo",
	temperature: 1,
	maxTokens: 256,
	topP: 1,
	frequencyPenalty: 0,
	presencePenalty: 0,
	dataDir: "Data",
	dataFilePath: ""
}

export default class OpenAIPlugin extends Plugin {
	settings: OpenAISettings;

	async onload() {
		await this.loadSettings();

		const root = this.app.vault.getRoot().path;
		const dataDirPath = `${root}${this.settings.dataDir}`;
		const dataFolderExists = await this.app.vault.adapter.exists(dataDirPath);

		if (!dataFolderExists) {
			await this.app.vault.adapter.mkdir(dataDirPath);
		}

		const dataFileExists = await this.app.vault.adapter.exists(this.settings.dataFilePath);
		if (!dataFileExists) {
			await this.app.vault.adapter.write(this.settings.dataFilePath, "{'instructions': []}");
		}

		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Open API Loaded');

		this.addCommand({
			id: 'instruct',
			name: 'Instruct',
			hotkeys: [{ modifiers: ["Mod"], key: "/" }],
			callback: () => {
				new InstructionModal(this.app, this.settings, false).open();
			}
		});

		this.addCommand({
			id: 'instruct-multiple',
			name: 'Instruct - Multiple',
			callback: () => {
				new InstructionModal(this.app, this.settings, true).open();
			}
		});

		this.addCommand({
			id: 'find-instruction',
			name: 'Find Instruction',
			callback: () => {
				new FindInstructionModal(this.app, this.settings, false).open();
			}
		});

		this.addCommand({
			id: 'find-instruction-multiple',
			name: 'Find Instruction - Multiple',
			callback: () => {
				new FindInstructionModal(this.app, this.settings, true).open();
			}
		});

		this.addSettingTab(new OpenAISettingTab(this.app, this));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class Completion {
	app: App;
	settings: OpenAISettings;
	openai: OpenAI;

	constructor(app: App, settings: OpenAISettings) {
		this.app = app;
		this.settings = settings;
		this.openai = new OpenAI({
			apiKey: this.settings.apiKey,
			dangerouslyAllowBrowser: true
		});
	}

	async post(instruction: string) {
		const response = await this.openai.chat.completions.create({
			model: this.settings.model,
			messages: [
				{
					"role": "user",
					"content": instruction
				},
			],
			temperature: 1,
			max_tokens: 256,
			top_p: 1,
			frequency_penalty: 0,
			presence_penalty: 0,
		});

		return response.choices[0].message.content;
	}
}

class InstructionsDataFile {
	app: App;
	settings: OpenAISettings;

	constructor(app: App, settings: OpenAISettings) {
		this.app = app;
		this.settings = settings;
	}

	async findInstruction(instruction: string): Promise<void | Instruction> {
		const data = await this.loadInstructions();
		const instructions = data['instructions'];
		const instructionObj = instructions.find((instructionObj: Instruction) =>
			instructionObj.text.toLowerCase() === instruction.toLowerCase()
		);

		return instructionObj
	}

	async updateInstruction(instruction: Instruction) {
		const data = await this.loadInstructions();
		const instructions = data['instructions'];
		const instructionIndex = instructions.findIndex((instructionObj: Instruction) =>
			instructionObj.id === instruction.id
		);

		data['instructions'][instructionIndex] = instruction;

		const file = this.app.vault.getAbstractFileByPath(this.settings.dataFilePath);
		if (file instanceof TFile) {
			await this.app.vault.modify(file, JSON.stringify(data, null, 4));
		}
	}

	async loadInstructions() {
		const file = this.app.vault.getAbstractFileByPath(this.settings.dataFilePath);
		if (file instanceof TFile) {
			const fileContent = await this.app.vault.read(file);
			const data = JSON.parse(fileContent);
			return data;
		} else {
			console.log("File not found");
		}
	}

	async appendInstruction(instruction: string) {
		const instructionObj = {
			'id': Date.now(),
			'text': instruction,
			'usageCount': 1
		}

		try {
			const data = await this.loadInstructions();
			data['instructions'].push(instructionObj);

			const file = this.app.vault.getAbstractFileByPath(this.settings.dataFilePath);
			if (file instanceof TFile) {
				await this.app.vault.modify(file, JSON.stringify(data, null, 4));
			}
		} catch(error) {
			console.log(error);
		}
	}
}

class InstructionModal extends Modal {
	instruction: string;
	settings: OpenAISettings;
	multiple: boolean;

	constructor(app: App, settings: OpenAISettings, multiple: boolean) {
		super(app);
		this.settings = settings;
		this.multiple = multiple;
	}

	onOpen() {
		const {contentEl} = this;
		const mainDiv = contentEl.createDiv();
		mainDiv.setAttr("style", "margin-top: 5px;")

		const instructionTextArea = new TextAreaComponent(mainDiv);
		instructionTextArea.setPlaceholder('Enter your instruction here.');
		instructionTextArea.inputEl.style.width = '95%';
		instructionTextArea.onChange((value) => {
			this.instruction = value;
		});

		new ButtonComponent(mainDiv)
			.setButtonText("Submit")
			.onClick(() => {
				this.onSubmit(this.instruction);
				this.close()
			});
	}

	async onSubmit(instruction: string) {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (view) {
			const currentSelection = view.editor.getSelection();
			let prompt = instruction;
			const instructionsDataFile = new InstructionsDataFile(this.app, this.settings);
			const instructionObj = await instructionsDataFile.findInstruction(instruction);

			if (instructionObj) {
				instructionObj.usageCount += 1;
				await instructionsDataFile.updateInstruction(instructionObj);
			} else {
				await instructionsDataFile.appendInstruction(instruction);
			}

			if (currentSelection !== "" && this.multiple) {
				const selectionChunks = currentSelection.split("\n");
				const prompts = selectionChunks.map(chunk => prompt + "\n\n###\n\n" + chunk);

				const completions = await Promise.all(prompts.map(p => new Completion(this.app, this.settings).post(p)));

				let allCompletions = "";
				for (let i = 0; i < prompts.length; i++) {
					if (completions[i] && selectionChunks[i] !== "") {
						allCompletions += selectionChunks[i] + "\n" + completions[i] + "\n\n";
					} else if (completions[i]) {
						allCompletions += completions[i];
					}
				}
				view.editor.replaceSelection(allCompletions);
			} else if (currentSelection !== "" && !this.multiple) {
				prompt = prompt + "\n\n###\n\n" + currentSelection;
				const completion = await new Completion(this.app, this.settings).post(prompt);
				view.editor.replaceSelection(currentSelection + "\n" + completion);
			} else {
				const completion = await new Completion(this.app, this.settings).post(prompt);
				view.editor.replaceSelection(completion || "");
			}
		}
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class FindInstructionModal extends SuggestModal<Instruction> {
	settings: OpenAISettings;
	multiple: boolean;

	constructor(app: App, settings: OpenAISettings, multiple: boolean) {
		super(app);
		this.settings = settings;
		this.multiple = multiple;
	}

	async getSuggestions(query: string): Promise<Instruction[]> {
		const instructionsDataFile = new InstructionsDataFile(this.app, this.settings);
		const instructionsData = await instructionsDataFile.loadInstructions();
		const sortedInstructions = instructionsData["instructions"].sort((a: Instruction, b: Instruction) =>
			b.usageCount - a.usageCount
		);

		return sortedInstructions.filter((instruction: Instruction) =>
			instruction.text.toLowerCase().includes(query.toLowerCase())
		);
	}

	renderSuggestion(instruction: Instruction, el: HTMLElement) {
		el.createEl('div', { text: instruction.text });
		el.createEl('small', { text: instruction.usageCount.toString() });
	}

	async onChooseSuggestion(instruction: Instruction, evt: MouseEvent | KeyboardEvent): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (view) {
			const currentSelection = view.editor.getSelection();
			let prompt = instruction.text;
			const instructionsDataFile = new InstructionsDataFile(this.app, this.settings);
			const instructionObj = await instructionsDataFile.findInstruction(instruction.text);

			if (instructionObj) {
				instructionObj.usageCount += 1;
				await instructionsDataFile.updateInstruction(instructionObj);
			}

			if (currentSelection !== "" && this.multiple) {
				const selectionChunks = currentSelection.split("\n");
				const prompts = selectionChunks.map(chunk => prompt + "\n\n###\n\n" + chunk);
				const completions = await Promise.all(prompts.map(p => new Completion(this.app, this.settings).post(p)));

				let allCompletions = "";
				for (let i = 0; i < prompts.length; i++) {
					if (completions[i] && selectionChunks[i] !== "") {
						allCompletions += selectionChunks[i] + "\n" + completions[i] + "\n\n";
					} else if (completions[i]) {
						allCompletions += completions[i];
					}
				}

				view.editor.replaceSelection(allCompletions);
			} else if (currentSelection !== "" && !this.multiple) {
				prompt = prompt + "\n\n###\n\n" + currentSelection;
				const completion = await new Completion(this.app, this.settings).post(prompt);

				if (completion) {
					view.editor.replaceSelection(currentSelection + "\n" + completion);
				}
			} else {
				const completion = await new Completion(this.app, this.settings).post(prompt);
				view.editor.replaceSelection(completion || "");
			}
		}
	}
}

class OpenAISettingTab extends PluginSettingTab {
	plugin: OpenAIPlugin;

	constructor(app: App, plugin: OpenAIPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;
		containerEl.empty();
		containerEl.createEl('h2', {text: 'Settings for using the OpenAI API.'});

		new Setting(containerEl)
			.setName('API Key')
			.setDesc('Enter your OpenAI API key here.')
			.addText(text => text
				.setPlaceholder('API Key')
				.setValue(this.plugin.settings.apiKey)
				.onChange(async (value) => {
					this.plugin.settings.apiKey = value;
					await this.plugin.saveSettings();
				})
				.then((cb) => {
					cb.inputEl.style.width = '100%';
				}));

		new Setting(containerEl)
			.setName('Data File Path')
			.setDesc('Enter the path to the data file for storing instructions.')
			.addText(text => text
				.setPlaceholder('Data File Path')
				.setValue(this.plugin.settings.dataFilePath)
				.onChange(async (value) => {
					this.plugin.settings.dataFilePath = value;
					await this.plugin.saveSettings();
				})
				.then((cb) => {
					cb.inputEl.style.width = '100%';
				}));

		new Setting(containerEl)
			.setName('Model')
			.setDesc('Enter the model you want to use.')
			.addDropdown(dropdown => dropdown
				.addOption('gpt-4-1106-preview', 'gpt-4-1106-preview')
				.addOption('gpt-4-0613', 'gpt-4-0613')
				.addOption('gpt-4-0314', 'gpt-4-0314')
				.addOption('gpt-4', 'gpt-4')
				.addOption('gpt-3.5-turbo-16k', 'gpt-3.5-turbo-16k')
				.addOption('gpt-3.5-turbo', 'gpt-3.5-turbo')
				.setValue(this.plugin.settings.model)
				.onChange(async (value) => {
					this.plugin.settings.model = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
				.setName('Temperature')
				.setDesc('Enter the temperature value.')
				.addSlider(slider => slider
					.setLimits(0, 2, 0.01)
					.setValue(this.plugin.settings.temperature)
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					})
					.setDynamicTooltip()
					.then((slider) => {
						slider.sliderEl.style.width = '100%';
					})
				)
		new Setting(containerEl)
				.setName('Maximum Length')
				.setDesc('Enter the maximum length of the output.')
				.addSlider(slider => slider
					.setLimits(1, 4096, 1)
					.setValue(this.plugin.settings.maxTokens)
					.onChange(async (value) => {
						this.plugin.settings.maxTokens = value;
						await this.plugin.saveSettings();
					})
					.setDynamicTooltip()
					.then((slider) => {
						slider.sliderEl.style.width = '100%';
					})
				)
		new Setting(containerEl)
				.setName('Top P')
				.setDesc('Enter the top P value.')
				.addSlider(slider => slider
					.setLimits(0, 1, 0.01)
					.setValue(this.plugin.settings.topP)
					.onChange(async (value) => {
						this.plugin.settings.topP = value;
						await this.plugin.saveSettings();
					})
					.setDynamicTooltip()
					.then((slider) => {
						slider.sliderEl.style.width = '100%';
					})
				)

		new Setting(containerEl)
				.setName('Frequency Penalty')
				.setDesc('Enter the frequency penalty value.')
				.addSlider(slider => slider
					.setLimits(0, 2, 0.01)
					.setValue(this.plugin.settings.frequencyPenalty)
					.onChange(async (value) => {
						this.plugin.settings.frequencyPenalty = value;
						await this.plugin.saveSettings();
					})
					.setDynamicTooltip()
					.then((slider) => {
						slider.sliderEl.style.width = '100%';
					})
				)

		new Setting(containerEl)
				.setName('Presence Penalty')
				.setDesc('Enter the presence penalty value.')
				.addSlider(slider => slider
					.setLimits(0, 2, 0.01)
					.setValue(this.plugin.settings.presencePenalty)
					.onChange(async (value) => {
						this.plugin.settings.presencePenalty = value;
						await this.plugin.saveSettings();
					})
					.setDynamicTooltip()
					.then((slider) => {
						slider.sliderEl.style.width = '100%';
					})
				)
	}
}
