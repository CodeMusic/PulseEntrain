import { IS_WEB } from '../nativeOnly';

// Open a file dialog and read a chosen .imedx/.imed/.json as parsed JSON.
// Web-first: uses a DOM <input type=file>. Native gets a document-picker later;
// for now it rejects with a friendly message (the funnel is web-preview-first).
export function pickImedxFile() {
  return new Promise((resolve, reject) => {
    if (!IS_WEB || typeof document === 'undefined') {
      reject(new Error('Opening a file is available on the web for now.'));
      return;
    }
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.imedx,.imed,application/json';
    input.onchange = () => {
      const file = input.files && input.files[0];
      if (!file) {
        resolve(null); // dialog cancelled
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          resolve({ name: file.name, json: JSON.parse(String(reader.result)) });
        } catch (e) {
          reject(new Error("That file isn't valid JSON."));
        }
      };
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.readAsText(file);
    };
    input.click();
  });
}
