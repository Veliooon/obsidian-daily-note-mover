/* main.js */
const { Plugin, PluginSettingTab, Setting, Notice } = require('obsidian');

module.exports = class DailyNoteMoverPlugin extends Plugin {
  settings = {
    targetFolder: 'Old Daily Notes',
    showSummaryNotification: true,
    dateFormat: 'DD-MM-YYYY',
    useYearMonthSubfolders: false
  };

  async onload() {
    try {
      console.log('Daily Note Mover: Loading plugin version 1.17.0');
      // Load settings with fallback
      await this.loadSettings();
      console.log('Daily Note Mover: Settings loaded', this.settings);

      // Force save settings to ensure data.json exists
      await this.saveSettings();

      // Validate date format
      if (!this.isValidDateFormat(this.settings.dateFormat)) {
        console.warn(`Invalid date format: ${this.settings.dateFormat}, falling back to DD-MM-YYYY`);
        this.settings.dateFormat = 'DD-MM-YYYY';
        await this.saveSettings();
      }

      // Add settings tab
      this.addSettingTab(new DailyNoteMoverSettingTab(this.app, this));

      // Add command to relocate notes from old folder
      this.addCommand({
        id: 'relocate-old-daily-notes',
        name: 'Relocate Old Daily Notes to New Folder',
        callback: async () => {
          await this.relocateOldNotes();
          new Notice('Old daily notes relocated to ' + this.settings.targetFolder);
        }
      });

      // Add debug command to force-move notes
      this.addCommand({
        id: 'debug-move-daily-notes',
        name: 'Debug: Force Move Old Daily Notes',
        callback: async () => {
          await this.moveOldDailyNotes();
          new Notice('Debug: Finished moving old daily notes');
        }
      });

      // Run note-moving logic after workspace is ready
      this.app.workspace.onLayoutReady(async () => {
        console.log('Daily Note Mover: Workspace ready, starting move');
        await this.moveOldDailyNotes();
      });
    } catch (e) {
      console.error('Daily Note Mover: Failed to load plugin', e);
      new Notice(`Failed to load Daily Note Mover: ${e.message}`);
    }
  }

  // Validate date format
  isValidDateFormat(format) {
    if (!format || typeof format !== 'string') return false;
    return format.match(/(DD|MM|YYYY|YY|MMM|MMMM)/); // Must contain at least one date token
  }

  // Convert date format to regex and parse date
  getDateFormatInfo() {
    const format = this.settings.dateFormat || 'DD-MM-YYYY';
    const tokens = {
      'DD': { regex: '\\d{2}', type: 'day' }, // 01-31
      'MM': { regex: '\\d{2}', type: 'month' }, // 01-12
      'YYYY': { regex: '\\d{4}', type: 'year' }, // 4-digit year
      'YY': { regex: '\\d{2}', type: 'year' }, // 2-digit year
      'MMM': { regex: '[A-Za-z]{3}', type: 'month' }, // 3-letter month
      'MMMM': { regex: '[A-Za-z]{4,}', type: 'month' } // Full month
    };
    const monthNames = {
      'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
      'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12,
      'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6,
      'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
    };

    console.log(`Daily Note Mover: Building regex for format: ${format}`);
    let regexStr = '^';
    const parts = [];
    let separator = '';

    try {
      // Split format into tokens and separators
      const formatParts = format.split(/([-\/])/);
      console.log(`Daily Note Mover: Format parts: ${formatParts}`);

      for (const part of formatParts) {
        if (tokens[part]) {
          regexStr += tokens[part].regex;
          parts.push({ token: part, type: tokens[part].type });
          console.log(`Daily Note Mover: Added token ${part}: ${tokens[part].regex}`);
        } else if (part.match(/[-\/]/)) {
          separator = part;
          regexStr += part.replace(/[-\/]/g, '\\$&');
          console.log(`Daily Note Mover: Added separator: ${part}`);
        } else if (part) {
          console.warn(`Daily Note Mover: Unrecognized part: ${part}`);
          continue;
        }
      }

      regexStr += '\\.md$';
      const regex = new RegExp(regexStr);
      console.log(`Daily Note Mover: Generated regex for ${format}: ${regexStr}`);

      // Test regex
      const testStr = '02-12-2020.md';
      console.log(`Daily Note Mover: Testing regex ${regexStr} on ${testStr}: ${regex.test(testStr)}`);

      const parseDate = (dateStr) => {
        console.log(`Daily Note Mover: Parsing date string: ${dateStr}`);
        const cleanStr = dateStr.replace('.md', '');
        if (!regex.test(cleanStr + '.md')) {
          console.log(`Daily Note Mover: Date string ${cleanStr}.md does not match regex ${regex}`);
          return null;
        }

        const segments = cleanStr.split(separator).filter(s => s);
        console.log(`Daily Note Mover: Segments: ${segments}`);
        let day, month, year;
        let offset = 0;

        for (const part of parts) {
          const segment = segments[offset];
          if (!segment) {
            console.log(`Daily Note Mover: Missing segment at offset ${offset}`);
            return null;
          }
          if (part.type === 'day') {
            day = parseInt(segment, 10);
            if (day < 1 || day > 31) {
              console.log(`Daily Note Mover: Invalid day: ${day}`);
              return null;
            }
          } else if (part.type === 'month') {
            if (part.token === 'MMM' || part.token === 'MMMM') {
              month = monthNames[segment.toLowerCase()];
              if (!month) {
                console.log(`Daily Note Mover: Invalid month name: ${segment}`);
                return null;
              }
            } else {
              month = parseInt(segment, 10);
              if (month < 1 || month > 12) {
                console.log(`Daily Note Mover: Invalid month: ${month}`);
                return null;
              }
            }
          } else if (part.type === 'year') {
            year = parseInt(segment, 10);
            if (part.token === 'YY') {
              year = year < 50 ? 2000 + year : 1900 + year;
            }
            if (year < 1000 || year > 9999) {
              console.log(`Daily Note Mover: Invalid year: ${year}`);
              return null;
            }
          }
          offset++;
        }

        if (!day || !month || !year) {
          console.log(`Daily Note Mover: Missing day/month/year: ${day}, ${month}, ${year}`);
          return null;
        }

        // Validate date
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() + 1 !== month || date.getDate() !== day) {
          console.log(`Daily Note Mover: Invalid date: ${year}-${month}-${day}`);
          return null;
        }

        console.log(`Daily Note Mover: Valid date parsed: ${year}-${month}-${day}`);
        return date;
      };

      return { regex, parseDate };
    } catch (e) {
      console.error(`Daily Note Mover: Invalid date format regex for ${format}`, e);
      return this.getDateFormatInfo('DD-MM-YYYY'); // Fallback to default
    }
  }

  async moveOldDailyNotes() {
    try {
      const today = new Date();
      const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const targetFolder = this.settings.targetFolder;
      const { regex, parseDate } = this.getDateFormatInfo();

      // Ensure target folder exists
      if (!(await this.app.vault.adapter.exists(targetFolder))) {
        await this.app.vault.createFolder(targetFolder);
        console.log(`Daily Note Mover: Created folder: ${targetFolder}`);
      }

      // Get all files in the vault
      const files = this.app.vault.getFiles();
      console.log(`Daily Note Mover: Scanning ${files.length} files`);
      let movedCount = 0;
      let foundCount = 0;
      let skippedCount = 0;

      for (const file of files) {
        console.log(`Daily Note Mover: Checking file: ${file.name}, path: ${file.path}`);
        const regexResult = regex.test(file.name);
        console.log(`Daily Note Mover: Regex test for ${file.name}: ${regexResult}`);
        if (file.extension === 'md' && regexResult) {
          foundCount++;
          console.log(`Daily Note Mover: Found matching file: ${file.name}`);
          const fileDateStr = file.name.replace('.md', '');
          const fileDate = parseDate(fileDateStr);
          if (!fileDate) {
            console.log(`Daily Note Mover: Skipping ${file.name} due to invalid date format`);
            new Notice(`Invalid date format for ${file.name}, skipping`);
            skippedCount++;
            continue;
          }
          const fileISO = `${fileDate.getFullYear()}-${String(fileDate.getMonth() + 1).padStart(2, '0')}-${String(fileDate.getDate()).padStart(2, '0')}`;
          if (fileISO !== todayISO) {
            let newPath;
            if (this.settings.useYearMonthSubfolders) {
              const year = fileDate.getFullYear();
              const month = String(fileDate.getMonth() + 1).padStart(2, '0');
              const yearFolder = `${targetFolder}/${year}`;
              const monthFolder = `${yearFolder}/${month}`;
              // Create year and month folders if they don't exist
              if (!(await this.app.vault.adapter.exists(yearFolder))) {
                await this.app.vault.createFolder(yearFolder);
                console.log(`Daily Note Mover: Created year folder: ${yearFolder}`);
              }
              if (!(await this.app.vault.adapter.exists(monthFolder))) {
                await this.app.vault.createFolder(monthFolder);
                console.log(`Daily Note Mover: Created month folder: ${monthFolder}`);
              }
              newPath = `${monthFolder}/${file.name}`;
            } else {
              newPath = `${targetFolder}/${file.name}`;
            }
            if (!file.path.startsWith(targetFolder + '/')) {
              try {
                await this.app.vault.rename(file, newPath);
                movedCount++;
                new Notice(`Moved ${file.name} to ${newPath}`);
              } catch (e) {
                new Notice(`Error moving ${file.name}: ${e.message}`);
              }
            } else {
              console.log(`Daily Note Mover: Skipping ${file.name}, already in ${targetFolder}`);
              skippedCount++;
            }
          } else {
            console.log(`Daily Note Mover: Skipping ${file.name}, matches today's date`);
            skippedCount++;
          }
        }
      }
      console.log(`Daily Note Mover: Summary - Found: ${foundCount}, Moved: ${movedCount}, Skipped: ${skippedCount}`);
      if (this.settings.showSummaryNotification) {
        new Notice(`Found ${foundCount} notes in ${this.settings.dateFormat} format, moved ${movedCount}, skipped ${skippedCount} to ${targetFolder}`);
      }
    } catch (e) {
      console.error('Daily Note Mover: Error in moveOldDailyNotes', e);
      new Notice(`Error moving notes: ${e.message}`);
    }
  }

  async relocateOldNotes() {
    try {
      const oldFolder = 'Old Daily Notes';
      const targetFolder = this.settings.targetFolder;
      const { regex, parseDate } = this.getDateFormatInfo();

      if (!(await this.app.vault.adapter.exists(targetFolder))) {
        await this.app.vault.createFolder(targetFolder);
        console.log(`Daily Note Mover: Created folder: ${targetFolder}`);
      }

      const files = this.app.vault.getFiles().filter(file => file.path.startsWith(oldFolder + '/'));
      let movedCount = 0;

      for (const file of files) {
        if (file.extension === 'md' && regex.test(file.name)) {
          const fileDateStr = file.name.replace('.md', '');
          const fileDate = parseDate(fileDateStr);
          if (!fileDate) {
            console.log(`Daily Note Mover: Skipping ${file.name} due to invalid date format`);
            new Notice(`Invalid date format for ${file.name}, skipping`);
            continue;
          }
          let newPath;
          if (this.settings.useYearMonthSubfolders) {
            const year = fileDate.getFullYear();
            const month = String(fileDate.getMonth() + 1).padStart(2, '0');
            const yearFolder = `${targetFolder}/${year}`;
            const monthFolder = `${yearFolder}/${month}`;
            // Create year and month folders if they don't exist
            if (!(await this.app.vault.adapter.exists(yearFolder))) {
              await this.app.vault.createFolder(yearFolder);
              console.log(`Daily Note Mover: Created year folder: ${yearFolder}`);
            }
            if (!(await this.app.vault.adapter.exists(monthFolder))) {
              await this.app.vault.createFolder(monthFolder);
              console.log(`Daily Note Mover: Created month folder: ${monthFolder}`);
            }
            newPath = `${monthFolder}/${file.name}`;
          } else {
            newPath = `${targetFolder}/${file.name}`;
          }
          try {
            await this.app.vault.rename(file, newPath);
            movedCount++;
            new Notice(`Relocated ${file.name} to ${newPath}`);
          } catch (e) {
            new Notice(`Error relocating ${file.name}: ${e.message}`);
          }
        }
      }
      new Notice(`Relocated ${movedCount} notes from ${oldFolder} to ${targetFolder}`);
    } catch (e) {
      console.error('Daily Note Mover: Error in relocateOldNotes', e);
      new Notice(`Error relocating notes: ${e.message}`);
    }
  }

  async loadSettings() {
    try {
      this.settings = Object.assign({}, this.settings, await this.loadData());
      console.log('Daily Note Mover: Loaded settings from data.json', this.settings);
    } catch (e) {
      console.error('Daily Note Mover: Error loading settings', e);
      new Notice(`Error loading settings, using defaults`);
    }
  }

  async saveSettings() {
    try {
      await this.saveData(this.settings);
      console.log('Daily Note Mover: Saved settings to data.json', this.settings);
    } catch (e) {
      console.error('Daily Note Mover: Error saving settings', e);
      new Notice(`Error saving settings`);
    }
  }
}

class DailyNoteMoverSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Target folder for old daily notes')
      .setDesc('Enter the folder path where old daily notes will be moved.')
      .addText(text => text
        .setPlaceholder('Old Daily Notes')
        .setValue(this.plugin.settings.targetFolder)
        .onChange(async (value) => {
          this.plugin.settings.targetFolder = value || 'Old Daily Notes';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Date format for notes')
      .setDesc('Enter the date format for notes to scan (e.g., DD-MM-YYYY, YYYY-MM-DD, DDMMMYYYY). Use DD, MM, YYYY, YY, MMM, MMMM.')
      .addText(text => text
        .setPlaceholder('DD-MM-YYYY')
        .setValue(this.plugin.settings.dateFormat)
        .onChange(async (value) => {
          this.plugin.settings.dateFormat = value || 'DD-MM-YYYY';
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Show move summary notification')
      .setDesc('Toggle to show/hide the summary of moved and skipped notes on startup.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showSummaryNotification)
        .onChange(async (value) => {
          this.plugin.settings.showSummaryNotification = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Create subfolders for years and months')
      .setDesc('Toggle to organize notes into year and month subfolders (e.g., targetFolder/2020/12/note.md).')
      .addToggle(toggle => toggle
        .setValue(this.settings.useYearMonthSubfolders)
        .onChange(async (value) => {
          this.plugin.settings.useYearMonthSubfolders = value;
          await this.plugin.saveSettings();
        }));
  }
}