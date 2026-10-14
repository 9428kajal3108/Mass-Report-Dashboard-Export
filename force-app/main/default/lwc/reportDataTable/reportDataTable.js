import { LightningElement, api, track } from 'lwc';
import { NavigationMixin } from 'lightning/navigation';

const REPORT_COLUMNS = [
    {
        label: 'Report Name',
        fieldName: 'nameUrl',
        type: 'url',
        sortable: true,
        typeAttributes: { label: { fieldName: 'name' }, target: '_blank' }
    },
    { label: 'Developer Name', fieldName: 'developerName', type: 'text', sortable: true },
    { label: 'Folder Name', fieldName: 'folderName', type: 'text', sortable: true },
    { label: 'Created By', fieldName: 'createdByName', type: 'text', sortable: true }
];

const DASHBOARD_COLUMNS = [
    {
        label: 'Dashboard Title',
        fieldName: 'nameUrl',
        type: 'url',
        sortable: true,
        typeAttributes: { label: { fieldName: 'name' }, target: '_blank' }
    },
    { label: 'Developer Name', fieldName: 'developerName', type: 'text', sortable: true },
    { label: 'Folder Name', fieldName: 'folderName', type: 'text', sortable: true },
    { label: 'Type', fieldName: 'type', type: 'text', sortable: true },
    { label: 'Created By', fieldName: 'createdByName', type: 'text', sortable: true }
];

const PAGE_SIZE_OPTIONS = [
    { label: '10', value: '10' },
    { label: '25', value: '25' },
    { label: '50', value: '50' },
    { label: '100', value: '100' }
];

export default class ReportDataTable extends NavigationMixin(LightningElement) {

    /** Search result from Apex: { records, totalCount, success, errorMessage } */
    _searchResult = null;
    @api
    get searchResult() {
        return this._searchResult;
    }
    set searchResult(val) {
        this._searchResult = val;
        this._syncPageSelection();
    }

    /** Is a search in progress? */
    @api isLoading = false;

    /** Current page size */
    @api pageSize = 10;

    /** Current zero-based offset */
    _currentOffset = 0;
    @api
    get currentOffset() {
        return this._currentOffset;
    }
    set currentOffset(val) {
        this._currentOffset = val;
        this._syncPageSelection();
    }

    /**
     * 'reports' | 'dashboards' — drives column set, card title/icon,
     * empty state messages, and quick search placeholder.
     */
    @api objectMode = 'reports';

    @track quickSearchTerm = '';
    @track sortField       = 'nameUrl';
    @track sortDirection   = 'asc';
    @track selectedRowIds  = [];

    // ─── Internal Selection State ─────────────────────────────────────────────

    /** True when "select all across all pages" mode is active. */
    _selectAllActive = false;
    /** Full set of all selected IDs (persists across pages). */
    _allSelectedIds  = new Set();

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    renderedCallback() {
        // Safety net: ensure all rows on page are selected if _selectAllActive
        if (this._selectAllActive && this.filteredRecords.length > 0 && this.selectedRowIds.length !== this.filteredRecords.length) {
            this.selectedRowIds = this.filteredRecords.map(r => r.id);
        }
    }

    // ─── Public API (called by parent) ────────────────────────────────────────

    /**
     * Called by parent after fetching all IDs for "select all across pages".
     * Marks all IDs selected and re-checks the current page rows.
     */
    @api
    setAllSelectedIds(allIds) {
        this._selectAllActive = true;
        this._allSelectedIds  = new Set(allIds);
        this._syncPageSelection();
        this._emitSelection();
    }

    /**
     * Called by parent to fully reset selection (e.g. on new search or mode switch).
     */
    @api
    resetSelection() {
        this._selectAllActive = false;
        this._allSelectedIds  = new Set();
        this.selectedRowIds   = [];
        this._emitSelection();
    }

    // ─── Computed Getters ─────────────────────────────────────────────────────

    get isReportsMode()    { return this.objectMode === 'reports'; }
    get isDashboardsMode() { return this.objectMode === 'dashboards'; }
    get columns()          { return this.isDashboardsMode ? DASHBOARD_COLUMNS : REPORT_COLUMNS; }

    get pageSizeOptions() {
        return PAGE_SIZE_OPTIONS.map(o => ({
            ...o,
            selected: Number(o.value) === Number(this.pageSize)
        }));
    }

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
        let records = this.searchResult.records.map(r => ({
            ...r,
            nameUrl: this._buildRecordUrl(r.id)
        }));
        if (term) {
            records = records.filter(r =>
                (r.name          && r.name.toLowerCase().includes(term)) ||
                (r.developerName && r.developerName.toLowerCase().includes(term)) ||
                (r.folderName    && r.folderName.toLowerCase().includes(term)) ||
                (r.createdByName && r.createdByName.toLowerCase().includes(term)) ||
                (r.type          && r.type.toLowerCase().includes(term))
            );
        }
        return this._sortData(records);
    }

    get hasFilteredRecords() {
        return this.filteredRecords && this.filteredRecords.length > 0;
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
    }

    // ─── Row Selection ────────────────────────────────────────────────────────

    handleRowSelection(event) {
        const selectedRows = event.detail.selectedRows;
        const pageRecords = this.filteredRecords;
        const pageCount = pageRecords.length;
        const selectedCount = selectedRows.length;

        // ── Case 1: ALL rows on the current page just got selected (header checkbox) ──
        // Treat this as "select all across all pages" intent.
        if (selectedCount === pageCount && pageCount > 0) {
            this._selectAllActive = true;
            pageRecords.forEach(r => this._allSelectedIds.add(r.id));
            this.selectedRowIds = pageRecords.map(r => r.id);

            // If there are more records beyond this page, ask parent to fetch all IDs.
            // If this is the only page, just mark all current IDs as selected.
            if (this.searchResult && this.searchResult.totalCount > pageCount) {
                this.dispatchEvent(new CustomEvent('selectallpages', { bubbles: true }));
            } else {
                this._emitSelection();
            }
            return;
        }

        // ── Case 2: Deselect all from any page (header checkbox unchecked) ──
        if (selectedCount === 0) {
            this._selectAllActive = false;
            this._allSelectedIds = new Set();
            this.selectedRowIds = [];
            this._emitSelection();
            return;
        }

        // ── Case 3: Normal individual row toggle ──
        // Exit select-all mode; update only the per-row state for the current page.
        this._selectAllActive = false;
        const currentPageIds = new Set(pageRecords.map(r => r.id));
        const selectedPageIds = new Set(selectedRows.map(r => r.id));

        // Remove current page IDs from global set, then add back only the checked ones
        currentPageIds.forEach(id => this._allSelectedIds.delete(id));
        selectedPageIds.forEach(id => this._allSelectedIds.add(id));

        this.selectedRowIds = [...selectedPageIds];
        this._emitSelection();
    }

    // ─── Sorting ──────────────────────────────────────────────────────────────

    handleSort(event) {
        this.sortField = event.detail.fieldName;
        this.sortDirection = event.detail.sortDirection;
    }

    // ─── Pagination ───────────────────────────────────────────────────────────

    goFirst() { this._changePage(0); }
    goPrev() { this._changePage(Math.max(0, this.currentOffset - this.pageSize)); }
    goNext() { this._changePage(this.currentOffset + this.pageSize); }
    goLast() {
        const total = this.searchResult ? this.searchResult.totalCount : 0;
        const lastOffset = Math.floor((total - 1) / this.pageSize) * this.pageSize;
        this._changePage(lastOffset);
    }

    handlePageSizeChange(event) {
        const newSize = parseInt(event.target.value || event.detail.value, 10);
        // Changing page size resets everything
        this._selectAllActive     = false;
        this._allSelectedIds      = new Set();
        this.selectedRowIds       = [];
        this.dispatchEvent(
            new CustomEvent('pagechange', {
                detail: { pageSize: newSize, offset: 0, resetSelection: true },
                bubbles: true
            })
        );
    }

    // ─── Private Helpers ──────────────────────────────────────────────────────

    _changePage(newOffset) {
        this.quickSearchTerm = '';
        this.dispatchEvent(
            new CustomEvent('pagechange', {
                detail: { pageSize: this.pageSize, offset: newOffset, resetSelection: false },
                bubbles: true
            })
        );
    }

    /**
     * Builds a standard Salesforce Lightning record page URL.
     * The URL column opens it in a new tab via target: '_blank'.
     */
    _buildRecordUrl(recordId) {
        if (!recordId) return null;
        return '/lightning/r/' + recordId + '/view';
    }

    /**
     * Sorts an array of records by the current sortField and sortDirection.
     */
    _sortData(data) {
        if (!data || data.length <= 1) return data;
        const field = this.sortField === 'nameUrl' ? 'name' : this.sortField;
        const reverse = this.sortDirection === 'desc' ? -1 : 1;

        return [...data].sort((a, b) => {
            const valA = a[field] != null ? a[field].toString().toLowerCase() : '';
            const valB = b[field] != null ? b[field].toString().toLowerCase() : '';
            if (valA < valB) return -1 * reverse;
            if (valA > valB) return 1 * reverse;
            return 0;
        });
    }

    /**
     * Syncs the datatable's checked rows to match _allSelectedIds for the current page.
     * Called after page navigation renders new data (renderedCallback) and
     * after setAllSelectedIds is called by the parent.
     */
    _syncPageSelection() {
        const pageIds = (this.filteredRecords || []).map(r => r.id);
        if (this._selectAllActive) {
            // In select-all mode: every row on every page should be checked
            this.selectedRowIds = pageIds;
        } else {
            // Normal mode: only check rows that are in the global selection set
            this.selectedRowIds = pageIds.filter(id => this._allSelectedIds.has(id));
        }
    }

    _emitSelection() {
        const allIds = this._selectAllActive
            ? [...this._allSelectedIds]
            : [...this._allSelectedIds];
        this.dispatchEvent(
            new CustomEvent('selectionchange', {
                detail: {
                    selectedIds: allIds,
                    count: allIds.length
                },
                bubbles: true
            })
        );
    }
}
