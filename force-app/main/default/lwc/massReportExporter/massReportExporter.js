import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { loadScript } from 'lightning/platformResourceLoader';
import JSZIP from '@salesforce/resourceUrl/jszip';
import getReportFields from '@salesforce/apex/ReportQueryService.getReportFields';
import searchReports from '@salesforce/apex/ReportQueryService.searchReports';
import searchReportsByRawSOQL from '@salesforce/apex/ReportQueryService.searchReportsByRawSOQL';
import getAllReportIds from '@salesforce/apex/ReportQueryService.getAllReportIds';
import exportReports from '@salesforce/apex/ReportExportService.exportReports';

export default class MassReportExporter extends LightningElement {

    // ─── State ────────────────────────────────────────────────────────────────

    @api cardTitle = 'Mass Report/Dashboard Exporter';

    @wire(getReportFields)
    wiredFields({ data, error }) {
        if (data) { this.reportFields = data; }
        if (error) { this._showToast('Error', 'Could not load Report fields.', 'error'); }
    }

    @track reportFields = [];
    @track searchResult = null;
    @track isSearching = false;
    @track isExporting = false;
    @track pageSize = 10;
    @track currentOffset = 0;
    @track selectedCount = 0;
    @track pendingFormat = 'Excel';

    // Internal selection state
    _selectedIds = [];
    _selectAllAcrossPages = false;
    _currentConditionsJson = '[]';
    _currentLogic = 'AND';
    _currentRawSOQL = '';
    _currentMode = 'builder';
    _jszipLoaded = false;

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    connectedCallback() {
        // Pre-load JSZip so it is ready when the user exports
        loadScript(this, JSZIP)
            .then(() => { this._jszipLoaded = true; })
            .catch(() => { this._jszipLoaded = false; });
    }

    // ─── Filter Events ────────────────────────────────────────────────────────

    handleSearchRequest(event) {
        const { mode, conditions, logic, rawSOQL } = event.detail;
        this._currentMode = mode;
        this._currentLogic = logic;
        this.currentOffset = 0;
        this._resetSelection();

        if (mode === 'builder') {
            this._currentConditionsJson = JSON.stringify(conditions);
            this._currentRawSOQL = '';
            this._runBuilderSearch(0);
        } else {
            this._currentRawSOQL = rawSOQL;
            this._runRawSearch(0);
        }
    }

    handleClearFilters() {
        this.searchResult = null;
        this.currentOffset = 0;
        this._resetSelection();
    }

    // ─── Pagination Events ────────────────────────────────────────────────────

    handlePageChange(event) {
        const { pageSize, offset } = event.detail;
        this.pageSize = pageSize;
        this.currentOffset = offset;
        this._resetSelection();

        if (this._currentMode === 'builder') {
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
            this._selectedIds = selectedIds;
            this.selectedCount = count;
        } else {
            this._selectedIds = selectedPageIds;
            this.selectedCount = selectedPageIds.length;
        }
    }

    async handleSelectAllPages() {
        try {
            this.isSearching = true;
            const allIds = await getAllReportIds({
                conditionsJson: this._currentConditionsJson,
                logic: this._currentLogic
            });
            this._selectedIds = allIds;
            this.selectedCount = allIds.length;

            const table = this.refs.dataTable;
            if (table) { table.setAllSelectedIds(allIds); }

            this._showToast(
                'All Selected',
                allIds.length + ' reports selected across all pages.',
                'success'
            );
        } catch (e) {
            this._showToast('Error', 'Could not fetch all report IDs.', 'error');
        } finally {
            this.isSearching = false;
        }
    }

    // ─── Export Request (Direct Export) ───────────────────────────────────────

    handleExportRequest(event) {
        if (!this._selectedIds || this._selectedIds.length === 0) {
            this._showToast('No Selection', 'Please select at least one report.', 'warning');
            return;
        }
        const { format, asZip } = event.detail;
        this.pendingFormat = format;
        this._runExport(Boolean(asZip));
    }

    // ─── Core Export (Apex → base64 → Blob → download) ───────────────────────

    async _runExport(asZip) {
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
            this._showToast(
                'Export Error',
                e.body ? e.body.message : String(e),
                'error'
            );
        } finally {
            this.isExporting = false;
        }
    }

    // ─── Private: Download Helpers ────────────────────────────────────────────

    /**
     * Bundle all files returned from Apex into a single ZIP and trigger download.
     * Falls back to individual downloads if JSZip is unavailable.
     */
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
            this._triggerBlobDownload(zipBlob, 'MassExport_' + timestamp + '.zip');
        } else {
            // JSZip unavailable — fall back to individual
            if (files && files.length > 1) {
                this._showToast(
                    'ZIP Unavailable',
                    'JSZip library could not be loaded. Downloading files individually.',
                    'warning'
                );
            }
            await this._downloadIndividually(files);
        }
    }

    /**
     * Download each Apex-returned file one by one using base64 decode.
     */
    async _downloadIndividually(files) {
        for (let i = 0; i < files.length; i++) {
            await this._downloadBase64File(files[i]);
            if (i < files.length - 1) {
                await this._delay(400); // brief pause between downloads
            }
        }
    }

    /**
     * Convert a base64-encoded ExportFile (from Apex) to a Blob and trigger download.
     */
    _downloadBase64File(file) {
        return new Promise(resolve => {
            try {
                const byteChars = atob(file.base64Content);
                const byteArrays = [];
                for (let i = 0; i < byteChars.length; i += 512) {
                    const slice = byteChars.slice(i, i + 512);
                    const byteNums = new Array(slice.length);
                    for (let j = 0; j < slice.length; j++) {
                        byteNums[j] = slice.charCodeAt(j);
                    }
                    byteArrays.push(new Uint8Array(byteNums));
                }

                // Lightning Web Security (LWS) blocks non-whitelisted MIME types like application/vnd.ms-excel.
                // application/octet-stream is explicitly allowed by LWS and the browser relies on file.name (.xls/.csv).
                let blob;
                try {
                    blob = new Blob(byteArrays, { type: 'application/octet-stream' });
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

    /**
     * Create an object URL for the blob and programmatically click a hidden anchor.
     */
    _triggerBlobDownload(blob, fileName) {
        const url = URL.createObjectURL(blob);
        try {
            const a = document.createElement('a');
            a.href = url;
            a.download = fileName;
            a.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
            (document.body || document.documentElement).appendChild(a);
            a.click();
            setTimeout(() => {
                try {
                    (document.body || document.documentElement).removeChild(a);
                } catch (e) { /* ignore */ }
                URL.revokeObjectURL(url);
            }, 1500);
        } catch (e) {
            // Last-resort fallback
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 5000);
        }
    }

    // ─── Private: Apex Calls ─────────────────────────────────────────────────

    async _runBuilderSearch(offset) {
        this.isSearching = true;
        try {
            this.searchResult = await searchReports({
                conditionsJson: this._currentConditionsJson,
                logic: this._currentLogic,
                pageSize: this.pageSize,
                offset
            });
            if (!this.searchResult.success) {
                this._showToast('Search Error', this.searchResult.errorMessage, 'error');
            }
        } catch (e) {
            this._showToast('Search Error', e.body ? e.body.message : String(e), 'error');
            this.searchResult = {
                success: false,
                errorMessage: e.body ? e.body.message : String(e),
                records: [],
                totalCount: 0
            };
        } finally {
            this.isSearching = false;
        }
    }

    async _runRawSearch(offset) {
        this.isSearching = true;
        try {
            this.searchResult = await searchReportsByRawSOQL({
                rawSOQL: this._currentRawSOQL,
                pageSize: this.pageSize,
                offset
            });
            if (!this.searchResult.success) {
                this._showToast('Search Error', this.searchResult.errorMessage, 'error');
            }
        } catch (e) {
            this._showToast('Search Error', e.body ? e.body.message : String(e), 'error');
            this.searchResult = {
                success: false,
                errorMessage: e.body ? e.body.message : String(e),
                records: [],
                totalCount: 0
            };
        } finally {
            this.isSearching = false;
        }
    }

    // ─── Private: Helpers ─────────────────────────────────────────────────────

    _resetSelection() {
        this._selectedIds = [];
        this._selectAllAcrossPages = false;
        this.selectedCount = 0;
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
