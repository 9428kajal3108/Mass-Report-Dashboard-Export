import { LightningElement, api, track } from 'lwc';

const COLUMNS = [
    { label: 'Report Name',      fieldName: 'name',          type: 'text', sortable: true },
    { label: 'Developer Name',   fieldName: 'developerName', type: 'text', sortable: true },
    { label: 'Folder Name',      fieldName: 'folderName',    type: 'text', sortable: true }
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

    @track quickSearchTerm     = '';
    @track sortField           = 'name';
    @track sortDirection       = 'asc';
    @track selectedRowIds      = [];
    @track selectAllAcrossPages = false;
    @track showSelectAllBanner  = false;

    get columns()          { return COLUMNS; }
    get pageSizeOptions()  { return PAGE_SIZE_OPTIONS; }
    get pageSizeStr()      { return String(this.pageSize); }

    get hasResults() {
        return !this.isLoading
            && this.searchResult
            && this.searchResult.success
            && this.searchResult.records
            && this.searchResult.records.length > 0;
    }

    get isEmpty() {
        return !this.isLoading
            && this.searchResult
            && this.searchResult.success
            && (!this.searchResult.records || this.searchResult.records.length === 0);
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
        // Reset select-all-across-pages when search term changes
        if (this.selectAllAcrossPages) {
            this.selectAllAcrossPages = false;
            this.showSelectAllBanner  = false;
        }
    }

    // ─── Row Selection ────────────────────────────────────────────────────────

    handleRowSelection(event) {
        const selectedRows = event.detail.selectedRows;
        this.selectedRowIds = selectedRows.map(r => r.id);

        // Check if all visible rows on current page are selected
        const pageCount = this.filteredRecords.length;
        const allPageSelected = pageCount > 0 && this.selectedRowIds.length === pageCount;

        if (!allPageSelected) {
            this.showSelectAllBanner  = false;
            this.selectAllAcrossPages = false;
        } else {
            // Show banner only if there are more records beyond this page
            this.showSelectAllBanner =
                this.searchResult.totalCount > this.pageSize;
        }

        this._emitSelection();
    }

    handleSelectAllAcrossPages() {
        this.selectAllAcrossPages = true;
        // Emit event — parent will call getAllReportIds and pass back all IDs
        this.dispatchEvent(
            new CustomEvent('selectallpages', { bubbles: true })
        );
    }

    handleClearAllSelection() {
        this.selectedRowIds      = [];
        this.selectAllAcrossPages = false;
        this.showSelectAllBanner  = false;
        this._emitSelection();
    }

    /** Called by parent when all IDs are fetched — update local selection display. */
    @api
    setAllSelectedIds(allIds) {
        this.selectAllAcrossPages = true;
        // Only mark current-page rows as checked in the datatable
        const pageIds = new Set((this.filteredRecords || []).map(r => r.id));
        this.selectedRowIds = allIds.filter(id => pageIds.has(id));
        this._emitSelection(allIds);
    }

    // ─── Sorting ──────────────────────────────────────────────────────────────

    handleSort(event) {
        this.sortField     = event.detail.fieldName;
        this.sortDirection = event.detail.sortDirection;
        // Sorting is client-side on current page
    }

    // ─── Pagination ───────────────────────────────────────────────────────────

    goFirst() { this._changePage(0); }
    goPrev()  { this._changePage(Math.max(0, this.currentOffset - this.pageSize)); }
    goNext()  { this._changePage(this.currentOffset + this.pageSize); }
    goLast()  {
        const total = this.searchResult ? this.searchResult.totalCount : 0;
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
