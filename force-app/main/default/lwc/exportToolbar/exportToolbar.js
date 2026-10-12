import { LightningElement, api, track } from 'lwc';

const REPORT_FORMAT_OPTIONS = [
    { label: 'Excel (.xls)', value: 'Excel' },
    { label: 'CSV (.csv)',   value: 'CSV' }
];

const MAX_REPORTS    = 50;
const MAX_DASHBOARDS = 20;

export default class ExportToolbar extends LightningElement {

    /** Number of currently selected items. */
    @api selectedCount = 0;

    /** Whether an export operation is in progress. */
    @api isExporting = false;

    /**
     * 'reports' | 'dashboards' — controls format options visibility and limit.
     * Dashboards: JPG only (no format selector shown).
     * Reports: Excel or CSV.
     */
    @api objectMode = 'reports';

    @track selectedFormat = 'Excel';
    @track isZip          = false;

    formatOptions = REPORT_FORMAT_OPTIONS;

    // ─── Computed Getters ─────────────────────────────────────────────────────

    get isReportsMode()    { return this.objectMode === 'reports'; }
    get isDashboardsMode() { return this.objectMode === 'dashboards'; }

    get maxItems()         { return this.isDashboardsMode ? MAX_DASHBOARDS : MAX_REPORTS; }
    get showLimitWarning() { return this.selectedCount > this.maxItems; }

    get limitWarningText() {
        if (this.isDashboardsMode) {
            return 'Max ' + MAX_DASHBOARDS + ' dashboards. Only first ' + MAX_DASHBOARDS + ' will be exported.';
        }
        return 'Max ' + MAX_REPORTS + ' reports. Only first ' + MAX_REPORTS + ' will be exported.';
    }

    get isExportDisabled()  { return this.selectedCount === 0 || this.isExporting; }

    get exportButtonLabel() {
        if (this.isExporting) {
            return this.isDashboardsMode ? 'Exporting images...' : 'Exporting...';
        }
        const count = this.selectedCount || 0;
        if (this.isDashboardsMode) {
            return this.isZip
                ? 'Export as ZIP (' + count + ')'
                : 'Download JPG (' + count + ')';
        }
        return this.isZip
            ? 'Export as ZIP (' + count + ')'
            : 'Export Now (' + count + ')';
    }

    get exportingLabel() {
        return this.isDashboardsMode ? 'Exporting dashboard images...' : 'Exporting reports...';
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

    // ─── Handlers ─────────────────────────────────────────────────────────────

    handleFormatChange(event) {
        this.selectedFormat = event.detail.value || event.target.value;
    }

    handleZipChange(event) {
        this.isZip = event.target.checked;
    }

    handleExport() {
        // Dashboards always export as JPG (format not applicable)
        const format = this.isDashboardsMode ? 'JPG' : this.selectedFormat;
        this.dispatchEvent(
            new CustomEvent('exportrequest', {
                detail: { format, asZip: this.isZip },
                bubbles: true
            })
        );
    }
}
