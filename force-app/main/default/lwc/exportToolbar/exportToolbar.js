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
    @track isZip = false;

    formatOptions = FORMAT_OPTIONS;

    get showLimitWarning()  { return this.selectedCount > MAX_REPORTS; }
    get isExportDisabled()  { return this.selectedCount === 0 || this.isExporting; }
    get exportButtonLabel() {
        if (this.isExporting) {
            return 'Exporting...';
        }
        const count = this.selectedCount || 0;
        return this.isZip
            ? 'Export as ZIP (' + count + ')'
            : 'Export Now (' + count + ')';
    }
    get selectedBadgeLabel() {
        const count = this.selectedCount || 0;
        return `${count} selected`;
    }

    get selectedBadgeClass() {
        return (this.selectedCount > 0)
            ? 'slds-badge slds-theme_success badge-pill'
            : 'slds-badge slds-badge_lightest badge-pill';
    }

    handleFormatChange(event) {
        this.selectedFormat = event.detail.value || event.target.value;
    }

    handleZipChange(event) {
        this.isZip = event.target.checked;
    }

    handleExport() {
        this.dispatchEvent(
            new CustomEvent('exportrequest', {
                detail: {
                    format: this.selectedFormat,
                    asZip: this.isZip
                },
                bubbles: true
            })
        );
    }
}
