import { LightningElement, api, track } from 'lwc';

const FORMAT_OPTIONS = [
    { label: 'Excel (.xls)', value: 'Excel' },
    { label: 'CSV (.csv)',   value: 'CSV' }
];

const MAX_REPORTS = 50;

export default class ExportToolbar extends LightningElement {
    /** Number of currently selected reports. */
    @api selectedCount = 0;

    /** Whether an export operation is in progress. */
    @api isExporting = false;

    @track selectedFormat = 'Excel';
    formatOptions = FORMAT_OPTIONS;

    get showLimitWarning()  { return this.selectedCount > MAX_REPORTS; }
    get isExportDisabled()  { return this.selectedCount === 0 || this.isExporting; }
    get exportButtonLabel() {
        return this.isExporting
            ? 'Exporting...'
            : 'Export Now (' + (this.selectedCount || 0) + ')';
    }
    get selectedLabel() {
        const n = this.selectedCount || 0;
        return n === 0
            ? 'No reports selected'
            : n + ' report' + (n === 1 ? '' : 's') + ' selected';
    }

    handleFormatChange(event) {
        this.selectedFormat = event.detail.value || event.target.value;
    }

    handleExport() {
        this.dispatchEvent(
            new CustomEvent('exportrequest', {
                detail: { format: this.selectedFormat },
                bubbles: true
            })
        );
    }
}
