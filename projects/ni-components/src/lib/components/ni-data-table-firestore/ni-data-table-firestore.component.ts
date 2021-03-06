import { Component, OnInit, Input, ViewChild, OnDestroy, AfterViewInit, Output, EventEmitter, QueryList, ViewChildren } from '@angular/core';
import { MatTableDataSource } from '@angular/material/table'
import { MatSort } from '@angular/material/sort'
import { MatPaginator } from '@angular/material/paginator';
import { Subject, Observable, merge, of as observableOf } from 'rxjs'
import { catchError, map, startWith, switchMap, takeUntil } from 'rxjs/operators'
import { SelectionModel } from '@angular/cdk/collections'
import { trigger, state, style, transition, animate } from '@angular/animations'
import { differenceBy, differenceWith, isEqual } from 'lodash'
import { DomSanitizer } from '@angular/platform-browser'

import { NiFirestoreService } from 'ni-firestore-functions'
import { NiHelperSnippetsService } from 'ni-helper-snippets'

import { NiFilters } from '../ni-filters/ni-filters.component'
import { NiTopTabs } from '../ni-top-tabs/ni-top-tabs.component'
import { NiRow } from '../../directives/ni-row/ni-row.directive';

@Component({
  selector: 'ni-data-table-firestore',
  templateUrl: './ni-data-table-firestore.component.html',
  styleUrls: ['./ni-data-table-firestore.component.scss'],
  animations: [
    trigger('removingRow', [
		state('active', style({})),
      	state('removing', style({opacity: '1', background: '#fbe9e7', color: '#d50000',})),
      	/*transition('* => removing', animate(600, keyframes([
			style({opacity: 1, transform: 'translateX(0)',     offset: 0}),
        	style({opacity: 1, transform: 'translateX(15px)', offset: 0.7}),
        	style({opacity: 0, transform: 'translateX(-100%)',  offset: 1.0})
		  ]))),*/
		transition('* => removing', animate('1000ms ease'))
      	//transition('unchecked => completed', animate('1250ms 1s ease-out'))
    ])
  ]
})
export class NiDataTableFirestore implements OnInit, OnDestroy, AfterViewInit {

	@Input() collection: string
	@Input() path: any[]
	//@Input() parentDoc: any
	@Input() tabs: any[]
	@Input() tabsStyle: string // default | joined
	@Input() filtered: any[]
	@Input() filtersSections: Observable<any[]>
	@Input() hideSearchSection: boolean
	@Input() hidePaginator: boolean
	@Input() columns: any[]
	@Input() sortActive: string
	@Input() sortDirection: string
	@Input() tableActions: any[]
	@Input() rowActions: any[]
	@Input() height: string = '500px'
	@Input() searchKey: string
	@Input() searchPlaceholder: string

	@Output() rowAction = new EventEmitter()
	@Output() tableAction = new EventEmitter()

	displayedColumns = ['select']

	data: any[]
	dataCollection: any

	dataSource: any
	selection = new SelectionModel<Element>(true, []);
	total = 0;
  	isLoadingResults = true;
	isRateLimitReached = false;
	@ViewChild(MatPaginator, { static: true }) paginator: MatPaginator;
	@ViewChild(MatSort, { static: true }) sort: MatSort;
	@ViewChild(NiFilters, { static: true }) filters: NiFilters;
	@ViewChild(NiTopTabs, { static: true }) topTabs: NiTopTabs;
	@ViewChildren(NiRow) niRows: QueryList<NiRow>

	previousPageIndex
	pageSize
	activeTab
	statusFiltered

	contextMenuPosition = { x: '0px', y: '0px' }

	rowSelected: NiRow
	rowSelectedIndex = -1

	private unsubscribe = new Subject<void>()

	constructor(
		private firestoreService: NiFirestoreService, 
		private functions: NiHelperSnippetsService,
		public sanitizer: DomSanitizer
	) {
		this.dataSource = new MatTableDataSource()
	}

	ngOnInit() {
		this.columns.map(column => {
			this.displayedColumns.push(column.key)
		})
	}

	ngAfterViewInit(){
		this.getData()
	}

	getData(){
		//Clear Selected rows
		this.selection.clear()

		this.paginator.pageIndex = 0

		// If the user changes the sort order or pageSize, reset back to the first page.
		this.sort.sortChange.pipe(takeUntil(this.unsubscribe)).subscribe(() => this.paginator.pageIndex = 0);
		this.paginator.page.pipe(takeUntil(this.unsubscribe)).subscribe(() => {
			if(this.pageSize !== this.paginator.pageSize){
				this.paginator.pageIndex = 0
			}
		});

		merge(this.sort.sortChange, this.paginator.page, this.filters.applyFilters, this.topTabs.active)
		.pipe(
			startWith({}),
			switchMap(() => {
				this.selection.clear()
				
				this.isLoadingResults = true;
				this.isRateLimitReached = false;

				let args = {
					collection: this.collection,
					parent: this.path,
					filters: []
				}

				/*if(this.parentDoc){
					args['parentDoc'] = this.parentDoc
				}*/

				if(this.filtered){
					this.filtered.map(filter => {
						args.filters.push(filter)
					})
				}

				if(this.tabs){
					let status = this.tabs[this.topTabs.selectedTab].data
					if(status && status !== 'any'){
						this.statusFiltered = true
						args.filters.push({
							key: 'status',
							value: status,
							operator: '=='
						})
					}else{
						this.statusFiltered = false
					}
				}

				if(this.filters.filtered){
					this.dataSource.data = []
					this.filters.activeFilters.map(filter => {
						args.filters.push(filter)
					})

					return this.firestoreService.getCollection(args)
				}

				args['orderBy'] = this.sort ? this.sort.active : null
				args['order'] = this.sort ? this.sort.direction : null
				args['limit'] = this.paginator ? this.paginator.pageSize : 20,
				args['paginator'] = {
					page: this.paginator ? this.paginator.pageIndex : 0,
					previousPage: this.previousPageIndex,
					firstVisible: this.data && this.data.length > 0 ? this.data[0] : null,
					lastVisible: this.data && this.data.length > 0 ? this.data[this.data.length-1] : null
				}
				
				if(this.sort.sortChange || this.paginator.page){
					this.dataSource.data = []
				}

				return this.firestoreService.getCollection(args)
			}),
			map((res: any) => {
				// Flip flag to show that loading has finished.
				this.isLoadingResults = false
				this.isRateLimitReached = false
				this.total = res.data().length
				this.previousPageIndex = this.paginator ? this.paginator.pageIndex : 0
				this.pageSize = this.paginator ? this.paginator.pageSize : 0
				this.activeTab = this.topTabs.selectedTab
				this.dataCollection = res.collection()

				return res.data();
			}),
			catchError(err => {
				this.isLoadingResults = false;
				// Catch if the API has reached its rate limit. Return empty data.
				this.isRateLimitReached = true;

				console.error(err)
				
				return observableOf([]);
			}),
			takeUntil(this.unsubscribe)
		).subscribe(data => {
			this.data = data
			this.loadCollection()
		})
	}

	loadCollection(){
		// load all documents when init
		if(this.dataSource.data.length <= 0){
			this.dataSource.data = this.data
			return
		}

		// add new documents
		let diff1 = differenceBy(this.dataSource.data, this.data, 'id')
		let diff2 = differenceBy(this.data, this.dataSource.data, 'id')
		if(this.dataSource.data.length > 0 && diff2 && diff2.length > 0){
			diff2.map((doc: any) => {
				let data = this.dataSource.data.slice();
				data.unshift(doc);
				this.dataSource.data = data;
			})
		}

		//remove documents
		if(this.dataSource.data.length > 0 && diff1 && diff1.length > 0){
			diff1.map((doc: any) => {
				this.dataSource.data = this.functions.removeObject(this.dataSource.data, 'id', doc.id)
			})
		}

		// compare & edit documents
		let diff = differenceWith(this.data, this.dataSource.data, isEqual)
		if(diff && diff.length > 0 && diff2.length <= 0){
			this.dataSource.data.map(doc => {
				let findDoc = this.functions.findObject(diff, 'id', doc.id)
				if(findDoc){
					let keys = Object.keys(doc)
					keys.map(key => {
						let val1 = doc[key]
						let val2 = findDoc[key]
						if(val1 !== val2){
							doc[key] = val2
						}
					})
				}
			})
		}
	}

	//Whether the number of selected elements matches the total number of rows.
	isAllSelected() {
		const numSelected = this.selection.selected.length;
		const numRows = this.dataSource.data.length;
		return numSelected === numRows;
	}

	//Selects all rows if they are not all selected; otherwise clear selection.
	masterToggle() {
		this.isAllSelected() ?
			this.selection.clear() :
			this.dataSource.data.forEach(row => {
				this.selection.select(row)
			});
	}

	onRightClick(event, actionsPanel, rowData, index){
		event.preventDefault();
		
		if(!this.rowActions.length) return;

		this.rowSelected = this.niRows.toArray()[index]
		this.rowSelectedIndex = index
    	this.contextMenuPosition.x = event.clientX + 'px';
		this.contextMenuPosition.y = event.clientY + 'px';
		actionsPanel.openMenu()
	}

	actionsClosed(event){
		this.rowSelected = null
		this.rowSelectedIndex = -1
	}

	runRowAction(action, row: NiRow){
		action.action(row)
		this.rowAction.emit(row)
	}

	getRowActionPermissions({canActivate}, row: NiRow, i) {
		if(typeof canActivate === 'boolean'){
			return canActivate
		}
		return canActivate ? canActivate(row) : true
	}

	getTableActionPermissions({canActivate}) {
		if(typeof canActivate === 'boolean'){
			return canActivate
		}
		return canActivate(this.selection.selected)
	}

	runTableAction(action){
		if(!this.getTableActionPermissions(action)) return;
		const items = this.selection.selected.map(item => {
			const findRow = this.niRows.toArray().filter(r => r['id'] === item['id'])
			return findRow[0]
		})
		action.action(items)
		this.tableAction.emit(items)
	}

	ngOnDestroy() {
		this.unsubscribe.next();
    	this.unsubscribe.complete();
	}

}