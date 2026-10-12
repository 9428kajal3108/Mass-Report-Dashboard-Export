import { LightningElement, api, track } from 'lwc';

const REPORT_COLUMNS = [
    { label: 'Report Name',    fieldName: 'name',          type: 'text', sortable: true },
    { label: 'Developer Name', fieldName: 'developerName', type: 'text', sortable: true },
    { label: 'Folder Name',    fieldName: 'folderName',    type: 'text', sortable: true }
];

const DASHBOARD_COLUMNS = [
    { label: 'Dashboard Title', fieldName: 'name',          type: 'text', sortable: true },
    { label: 'Developer Name',  fieldName: 'developerName', type: 'text', sortable: true },
    { label: 'Folder Name',     fieldName: 'folderName',    type: 'text', sortable: true },
    { label: 'Type',            fieldName: 'type',          type: 'text', sortable: true }
];

const PAGE_SIZE_OPTIONS = [
    { label: '10',  value: '10' },
    { label: '25',  value: '25' },
    { label: '50',  value: '50' },
    { label: '100', value: '100' }
];

export default class ReportDataTable extends LightningElement {

    /** Search result from Apex: { records, totalCount, success, errorMessage } */
    @api searchResult = null;

    /** Is a search in progress? */
    @api isLoading = false;

    /** Current page size */
    @api pageSize = 10;

    /** Current zero-based offset */
    @api currentOffset = 0;

    /**
     * 'reports' | 'dashboards' — drives column set, card title/icon,
     * empty state messages, and quick search placeholder.
     */
    @api objectMode = 'reports';

    @track quickSearchTerm      = '';
    @track sortField            = 'name';
    @track sortDirection        = 'asc';
    @track selectedRowIds       = [];
    @track selectAllAcrossPages = false;
    @track showSelectAllBanner  = false;

    // ─── Computed Getters ─────────────────────────────────────────────────────

    get isReportsMode()    { return this.objectMode === 'reports'; }
    get isDashboardsMode() { return this.objectMode === 'dashboards'; }

    get columns()         { return this.isDashboardsMode ? DASHBOARD_COLUMNS : REPORT_COLUMNS; }
    get pageSizeOptions() { return PAGE_SIZE_OPTIONS; }
    get pageSizeStr()     { return String(this.pageSize); }

    get cardTitle() {
        return this.isDashboardsMode ? 'List of Dashboards' : 'List of Reports';
    }

    get cardIconName() {
        return this.isDashboardsMode ? 'standard:dashboard' : 'standard:report';
    }

    get loadingLabel() {
        return this.isDashboardsMode ? 'Loading dashboards...' : 'Loading reports...';
    }

    get emptyStateIcon() {
        return this.isDashboardsMode ? 'utility:dashboard' : 'utility:search';
    }

    get emptyStateTitle() {
        return this.isDashboardsMode ? 'No dashboards found' : 'No reports found';
    }

    get emptyStateSubtitle() {
        return this.isDashboardsMode
            ? 'Use the filter above to search for dashboards.'
            : 'Use the filter above to search for reports.';
    }

    get quickSearchPlaceholder() {
        return this.isDashboardsMode
            ? 'Filter by title or folder...'
            : 'Filter by name or folder...';
    }

    get totalCountLabel() {
        const count = this.searchResult ? this.searchResult.totalCount : 0;
        return 'Total: ' + count;
    }

    get hasResults() {
        return !this.isLoading
            && this.searchResult
            && this.searchResult.success
            && this.searchResult.records
            && this.searchResult.records.length > 0;
    }

    get isEmpty() {
        return !this.isLoading
            && (
                !this.searchResult ||
                (this.searchResult.success && (!this.searchResult.records || this.searchResult.records.length === 0))
            );
    }

    get hasError() {
        return !this.isLoading
            && this.searchResult
            && !this.searchResult.success;
    }

    get filteredRecords() {
        if (!this.searchResult || !this.searchResult.records) return [];
        const term = this.quickSearchTerm.toLowerCase().trim();
        if (!term) return this.searchResult.records;
        return this.searchResult.records.filter(r =>
            (r.name          && r.name.toLowerCase().includes(term)) ||
            (r.developerName && r.developerName.toLowerCase().includes(term)) ||
            (r.folderName    && r.folderName.toLowerCase().includes(term))
        );
    }

    get isQuickFiltered() {
        return this.quickSearchTerm.trim().length > 0;
    }

    get totalPages() {
        if (!this.searchResult || !this.searchResult.totalCount) return 1;
        return Math.ceil(this.searchResult.totalCount / this.pageSize);
    }

    get currentPage() {
        return Math.floor(this.currentOffset / this.pageSize) + 1;
    }

    get isFirstPage() { return this.currentOffset === 0; }

    get isLastPage() {
        if (!this.searchResult) return true;
        return (this.currentOffset + this.pageSize) >= this.searchResult.totalCount;
    }

    // ─── Quick Search ─────────────────────────────────────────────────────────

    handleQuickSearch(event) {
        this.quickSearchTerm = event.detail.value;
        if (this.selectAllAcrossPages) {
            this.selectAllAcrossPages = false;
            this.showSelectAllBanner  = false;
        }
    }

    // ─── Row Selection ────────────────────────────────────────────────────────

    handleRowSelection(event) {
        const selectedRows = event.detail.selectedRows;
        this.selectedRowIds = selectedRows.map(r => r.id);

        const pageCount      = this.filteredRecords.length;
        const allPageSelected = pageCount > 0 && this.selectedRowIds.length === pageCount;

        if (!allPageSelected) {
            this.showSelectAllBanner  = false;
            this.selectAllAcrossPages = false;
        } else {
            this.showSelectAllBanner = this.searchResult.totalCount > this.pageSize;
        }

        this._emitSelection();
    }

    handleSelectAllAcrossPages() {
        this.selectAllAcrossPages = true;
        this.dispatchEvent(new CustomEvent('selectallpages', { bubbles: true }));
    }

    handleClearAllSelection() {
        this.selectedRowIds       = [];
        this.selectAllAcrossPages = false;
        this.showSelectAllBanner  = false;
        this._emitSelection();
    }

    /** Called by parent when all IDs are fetched — update local selection display. */
    @api
    setAllSelectedIds(allIds) {
        this.selectAllAcrossPages = true;
        const pageIds = new Set((this.filteredRecords || []).map(r => r.id));
        this.selectedRowIds = allIds.filter(id => pageIds.has(id));
        this._emitSelection(allIds);
    }

    // ─── Sorting ──────────────────────────────────────────────────────────────

    handleSort(event) {
        this.sortField     = event.detail.fieldName;
        this.sortDirection = event.detail.sortDirection;
    }

    // ─── Pagination ───────────────────────────────────────────────────────────

    goFirst() { this._changePage(0); }
    goPrev()  { this._changePage(Math.max(0, this.currentOffset - this.pageSize)); }
    goNext()  { this._changePage(this.currentOffset + this.pageSize); }
    goLast()  {
        const total      = this.searchResult ? this.searchResult.totalCount : 0;
        const lastOffset = Math.floor((total - 1) / this.pageSize) * this.pageSize;
        this._changePage(lastOffset);
    }

    handlePageSizeChange(event) {
        const newSize = parseInt(event.detail.value, 10);
        this.selectAllAcrossPages = false;
        this.showSelectAllBanner  = false;
        this.selectedRowIds       = [];
        this.dispatchEvent(
            new CustomEvent('pagechange', {
                detail: { pageSize: newSize, offset: 0 },
                bubbles: true
            })
        );
    }

    // ─── Private ──────────────────────────────────────────────────────────────

    _changePage(newOffset) {
        this.selectAllAcrossPages = false;
        this.showSelectAllBanner  = false;
        this.selectedRowIds       = [];
        this.quickSearchTerm      = '';
        this.dispatchEvent(
            new CustomEvent('pagechange', {
                detail: { pageSize: this.pageSize, offset: newOffset },
                bubbles: true
            })
        );
    }

    _emitSelection(overrideIds) {
        const ids = overrideIds || (this.selectAllAcrossPages ? [] : this.selectedRowIds);
        this.dispatchEvent(
            new CustomEvent('selectionchange', {
                detail: {
                    selectedIds:          ids,
                    selectedPageIds:      this.selectedRowIds,
                    selectAllAcrossPages: this.selectAllAcrossPages,
                    count:                this.selectAllAcrossPages
                        ? (this.searchResult ? this.searchResult.totalCount : 0)
                        : this.selectedRowIds.length
                },
                bubbles: true
            })
        );
    }
}
