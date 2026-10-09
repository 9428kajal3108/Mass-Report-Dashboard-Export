import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { loadScript } from 'lightning/platformResourceLoader';
import JSZIP from '@salesforce/resourceUrl/jszip';

// ── Report Apex imports ──────────────────────────────────────────────────────
import getReportFields        from '@salesforce/apex/ReportQueryService.getReportFields';
import searchReports          from '@salesforce/apex/ReportQueryService.searchReports';
import searchReportsByRawSOQL from '@salesforce/apex/ReportQueryService.searchReportsByRawSOQL';
import getAllReportIds         from '@salesforce/apex/ReportQueryService.getAllReportIds';
import exportReports          from '@salesforce/apex/ReportExportService.exportReports';

// ── Dashboard Apex imports ───────────────────────────────────────────────────
import getDashboardFields          from '@salesforce/apex/DashboardQueryService.getDashboardFields';
import searchDashboards            from '@salesforce/apex/DashboardQueryService.searchDashboards';
import searchDashboardsByRawSOQL   from '@salesforce/apex/DashboardQueryService.searchDashboardsByRawSOQL';
import getAllDashboardIds           from '@salesforce/apex/DashboardQueryService.getAllDashboardIds';
import exportDashboards            from '@salesforce/apex/DashboardExportService.exportDashboards';

const MODE_REPORTS    = 'reports';
const MODE_DASHBOARDS = 'dashboards';

export default class MassReportExporter extends LightningElement {

    // ─── Public API ───────────────────────────────────────────────────────────

    @api cardTitle = 'Mass Report/Dashboard Exporter';

    // ─── Wired Fields ─────────────────────────────────────────────────────────

    @wire(getReportFields)
    wiredReportFields({ data, error }) {
        if (data)  { this.reportFields = data; }
        if (error) { this._showToast('Error', 'Could not load Report fields.', 'error'); }
    }

    @wire(getDashboardFields)
    wiredDashboardFields({ data, error }) {
        if (data)  { this.dashboardFields = data; }
        if (error) { this._showToast('Error', 'Could not load Dashboard fields.', 'error'); }
    }

    // ─── State ────────────────────────────────────────────────────────────────

    @track reportFields    = [];
    @track dashboardFields = [];
    @track searchResult    = null;
    @track isSearching     = false;
    @track isExporting     = false;
    @track pageSize        = 10;
    @track currentOffset   = 0;
    @track selectedCount   = 0;
    @track pendingFormat   = 'Excel';
    @track currentMode     = MODE_REPORTS; // 'reports' | 'dashboards'

    // Internal selection state
    _selectedIds             = [];
    _selectAllAcrossPages    = false;
    _currentConditionsJson   = '[]';
    _currentLogic            = 'AND';
    _currentRawSOQL          = '';
    _currentFilterMode       = 'builder'; // filter builder vs raw SOQL
    _jszipLoaded             = false;

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    connectedCallback() {
        loadScript(this, JSZIP)
            .then(() => { this._jszipLoaded = true; })
            .catch(() => { this._jszipLoaded = false; });
    }

    // ─── Computed Getters ─────────────────────────────────────────────────────

    get isReportsMode()    { return this.currentMode === MODE_REPORTS; }
    get isDashboardsMode() { return this.currentMode === MODE_DASHBOARDS; }

    get activeFields() {
        return this.isReportsMode ? this.reportFields : this.dashboardFields;
    }

    get headerIcon() {
        return this.isReportsMode ? 'standard:report' : 'standard:dashboard';
    }

    get headerSubtitle() {
        return this.isReportsMode
            ? 'Filter, select, and bulk-download Salesforce Reports as Excel or CSV.'
            : 'Filter, select, and bulk-download Salesforce Dashboards as JPG images.';
    }

    get reportsModeClass() {
        return this.isReportsMode
            ? 'mode-btn mode-btn--active'
            : 'mode-btn';
    }

    get dashboardsModeClass() {
        return this.isDashboardsMode
            ? 'mode-btn mode-btn--active'
            : 'mode-btn';
    }

    // ─── Mode Switching ───────────────────────────────────────────────────────

    switchToReports() {
        if (this.isReportsMode) return;
        this.currentMode = MODE_REPORTS;
        this._resetSearch();
    }

    switchToDashboards() {
        if (this.isDashboardsMode) return;
        this.currentMode = MODE_DASHBOARDS;
        this._resetSearch();
    }

    _resetSearch() {
        this.searchResult  = null;
        this.currentOffset = 0;
        this._resetSelection();
        this._currentConditionsJson = '[]';
        this._currentLogic          = 'AND';
        this._currentRawSOQL        = '';
        this._currentFilterMode     = 'builder';
    }

    // ─── Filter Events ────────────────────────────────────────────────────────

    handleSearchRequest(event) {
        const { mode, conditions, logic, rawSOQL } = event.detail;
        this._currentFilterMode    = mode;
        this._currentLogic         = logic;
        this.currentOffset         = 0;
        this._resetSelection();

        if (mode === 'builder') {
            this._currentConditionsJson = JSON.stringify(conditions);
            this._currentRawSOQL        = '';
            this._runBuilderSearch(0);
        } else {
            this._currentRawSOQL = rawSOQL;
            this._runRawSearch(0);
        }
    }

    handleClearFilters() {
        this.searchResult  = null;
        this.currentOffset = 0;
        this._resetSelection();
    }

    // ─── Pagination Events ────────────────────────────────────────────────────

    handlePageChange(event) {
        const { pageSize, offset } = event.detail;
        this.pageSize      = pageSize;
        this.currentOffset = offset;
        this._resetSelection();

        if (this._currentFilterMode === 'builder') {
            this._runBuilderSearch(offset);
        } else {
            this._runRawSearch(offset);
        }
    }

    // ─── Selection Events ─────────────────────────────────────────────────────

    handleSelectionChange(event) {
        const { selectedIds, selectedPageIds, selectAllAcrossPages, count } = event.detail;
        this._selectAllAcrossPages = selectAllAcrossPages;

        if (selectAllAcrossPages) {
            this._selectedIds    = selectedIds;
            this.selectedCount   = count;
        } else {
            this._selectedIds  = selectedPageIds;
            this.selectedCount = selectedPageIds.length;
        }
    }

    async handleSelectAllPages() {
        try {
            this.isSearching = true;
            let allIds;

            if (this.isReportsMode) {
                allIds = await getAllReportIds({
                    conditionsJson: this._currentConditionsJson,
                    logic: this._currentLogic
                });
            } else {
                allIds = await getAllDashboardIds({
                    conditionsJson: this._currentConditionsJson,
                    logic: this._currentLogic
                });
            }

            this._selectedIds  = allIds;
            this.selectedCount = allIds.length;

            const table = this.refs.dataTable;
            if (table) { table.setAllSelectedIds(allIds); }

            const label = this.isReportsMode ? 'reports' : 'dashboards';
            this._showToast(
                'All Selected',
                allIds.length + ' ' + label + ' selected across all pages.',
                'success'
            );
        } catch (e) {
            this._showToast('Error', 'Could not fetch all IDs.', 'error');
        } finally {
            this.isSearching = false;
        }
    }

    // ─── Export Request ───────────────────────────────────────────────────────

    handleExportRequest(event) {
        if (!this._selectedIds || this._selectedIds.length === 0) {
            const label = this.isReportsMode ? 'report' : 'dashboard';
            this._showToast('No Selection', 'Please select at least one ' + label + '.', 'warning');
            return;
        }
        const { format, asZip } = event.detail;
        this.pendingFormat = format;

        if (this.isDashboardsMode) {
            this._runDashboardExport(Boolean(asZip));
        } else {
            this._runReportExport(Boolean(asZip));
        }
    }

    // ─── Core Report Export ───────────────────────────────────────────────────

    async _runReportExport(asZip) {
        this.isExporting = true;
        this._showToast(
            'Exporting',
            'Preparing ' + this._selectedIds.length + ' report(s)... Please wait.',
            'info'
        );

        try {
            const result = await exportReports({
                reportIds: this._selectedIds.slice(0, 50),
                format: this.pendingFormat
            });

            if (!result.success) {
                this._showToast('Export Failed', result.errorMessage, 'error');
                return;
            }

            if (asZip) {
                await this._downloadAsZip(result.files);
            } else {
                await this._downloadIndividually(result.files);
            }

            this._showToast(
                'Export Complete',
                result.totalExported + ' report(s) exported successfully'
                + (result.totalFailed > 0
                    ? '. ' + result.totalFailed + ' failed — check error files.'
                    : '.'),
                result.totalFailed > 0 ? 'warning' : 'success'
            );
        } catch (e) {
            this._showToast('Export Error', e.body ? e.body.message : String(e), 'error');
        } finally {
            this.isExporting = false;
        }
    }

    // ─── Core Dashboard Export ────────────────────────────────────────────────

    async _runDashboardExport(asZip) {
        this.isExporting = true;
        this._showToast(
            'Exporting',
            'Preparing ' + this._selectedIds.length + ' dashboard image(s)... Please wait.',
            'info'
        );

        try {
            const result = await exportDashboards({
                dashboardIds: this._selectedIds.slice(0, 20)
            });

            if (!result.success) {
                this._showToast('Export Failed', result.errorMessage, 'error');
                return;
            }

            if (asZip) {
                await this._downloadAsZip(result.files);
            } else {
                await this._downloadIndividually(result.files);
            }

            this._showToast(
                'Export Complete',
                result.totalExported + ' dashboard image(s) exported successfully'
                + (result.totalFailed > 0
                    ? '. ' + result.totalFailed + ' failed — check error files.'
                    : '.'),
                result.totalFailed > 0 ? 'warning' : 'success'
            );
        } catch (e) {
            this._showToast('Export Error', e.body ? e.body.message : String(e), 'error');
        } finally {
            this.isExporting = false;
        }
    }

    // ─── Private: Download Helpers ────────────────────────────────────────────

    async _downloadAsZip(files) {
        if (!this._jszipLoaded || !window.JSZip) {
            try {
                await loadScript(this, JSZIP);
                this._jszipLoaded = true;
            } catch (err) {
                this._jszipLoaded = false;
            }
        }

        if (window.JSZip && files && files.length > 0) {
            const zip = new window.JSZip();
            const timestamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
            files.forEach(file => {
                zip.file(file.name, file.base64Content, { base64: true });
            });
            const zipBlob = await zip.generateAsync({ type: 'blob' });
            const prefix  = this.isReportsMode ? 'ReportExport' : 'DashboardExport';
            this._triggerBlobDownload(zipBlob, prefix + '_' + timestamp + '.zip');
        } else {
            if (files && files.length > 1) {
                this._showToast('ZIP Unavailable', 'JSZip library could not be loaded. Downloading files individually.', 'warning');
            }
            await this._downloadIndividually(files);
        }
    }

    async _downloadIndividually(files) {
        for (let i = 0; i < files.length; i++) {
            await this._downloadBase64File(files[i]);
            if (i < files.length - 1) {
                await this._delay(400);
            }
        }
    }

    _downloadBase64File(file) {
        return new Promise(resolve => {
            try {
                const byteChars = atob(file.base64Content);
                const byteArrays = [];
                for (let i = 0; i < byteChars.length; i += 512) {
                    const slice   = byteChars.slice(i, i + 512);
                    const byteNums = new Array(slice.length);
                    for (let j = 0; j < slice.length; j++) {
                        byteNums[j] = slice.charCodeAt(j);
                    }
                    byteArrays.push(new Uint8Array(byteNums));
                }

                let blob;
                try {
                    blob = new Blob(byteArrays, { type: file.mimeType || 'application/octet-stream' });
                } catch (e) {
                    blob = new Blob(byteArrays);
                }

                this._triggerBlobDownload(blob, file.name);
            } catch (err) {
                this._showToast('Download Error', 'Could not download ' + file.name + ': ' + (err.message || err), 'error');
            }
            resolve();
        });
    }

    _triggerBlobDownload(blob, fileName) {
        const url = URL.createObjectURL(blob);
        try {
            const a = document.createElement('a');
            a.href     = url;
            a.download = fileName;
            a.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
            (document.body || document.documentElement).appendChild(a);
            a.click();
            setTimeout(() => {
                try { (document.body || document.documentElement).removeChild(a); } catch (e) { /* ignore */ }
                URL.revokeObjectURL(url);
            }, 1500);
        } catch (e) {
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
    }

    // ─── Private: Apex Search Calls ───────────────────────────────────────────

    async _runBuilderSearch(offset) {
        this.isSearching = true;
        try {
            if (this.isReportsMode) {
                this.searchResult = await searchReports({
                    conditionsJson: this._currentConditionsJson,
                    logic: this._currentLogic,
                    pageSize: this.pageSize,
                    offset
                });
            } else {
                this.searchResult = await searchDashboards({
                    conditionsJson: this._currentConditionsJson,
                    logic: this._currentLogic,
                    pageSize: this.pageSize,
                    offset
                });
            }
            if (!this.searchResult.success) {
                this._showToast('Search Error', this.searchResult.errorMessage, 'error');
            }
        } catch (e) {
            this._showToast('Search Error', e.body ? e.body.message : String(e), 'error');
            this.searchResult = { success: false, errorMessage: e.body ? e.body.message : String(e), records: [], totalCount: 0 };
        } finally {
            this.isSearching = false;
        }
    }

    async _runRawSearch(offset) {
        this.isSearching = true;
        try {
            if (this.isReportsMode) {
                this.searchResult = await searchReportsByRawSOQL({
                    rawSOQL: this._currentRawSOQL,
                    pageSize: this.pageSize,
                    offset
                });
            } else {
                this.searchResult = await searchDashboardsByRawSOQL({
                    rawSOQL: this._currentRawSOQL,
                    pageSize: this.pageSize,
                    offset
                });
            }
            if (!this.searchResult.success) {
                this._showToast('Search Error', this.searchResult.errorMessage, 'error');
            }
        } catch (e) {
            this._showToast('Search Error', e.body ? e.body.message : String(e), 'error');
            this.searchResult = { success: false, errorMessage: e.body ? e.body.message : String(e), records: [], totalCount: 0 };
        } finally {
            this.isSearching = false;
        }
    }

    // ─── Private: Helpers ─────────────────────────────────────────────────────

    _resetSelection() {
        this._selectedIds          = [];
        this._selectAllAcrossPages = false;
        this.selectedCount         = 0;
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
