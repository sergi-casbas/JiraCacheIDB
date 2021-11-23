class JiraCachedDB {
    /**
     * 
     * @param {string} base_url Optional. Jira instance server base url https://myinstance.atllasian.net
     * @param {integer} max_request Optional. Max number of concurrent requests to Jira. WARNING change it may drive to unexpected results.
     */
    constructor(base_url="/", max_request=100) {
        this.base_url = base_url;
        this.indexed_db = new IndexedDBStorage('JiraCachedDB');
        this._pending = 0;
        this._MAX_REQUESTS = max_request;
    }
    
    async open (){
        await this.indexed_db.open(['issues'], 1);
    }
    
    async JQLQuery(JQL, statusFunction=null, statusArray=null, resultType="issues"){
        return await this._query_jira_api( this.base_url + "rest/api/latest/search?fields=id,updated&jql=" + JQL, resultType, statusFunction, statusArray);
    }

    async issue(issueObject, expand=null, callbackFunction = null){
        // Wait until MAX_REQUESTS threshold is not raised.
        while (this._pending > this._MAX_REQUESTS){
            await this._sleep();
        }

        // Mark as a new pending request and initialize local variables.
        this._pending ++;
        let response = {};
        let expansions = [];
        if (expand){
            expansions = expand.replace(/\s/g, "").split(",");
        }

        // Check if item in the cache is expired or is valid.
        let cached = await this.indexed_db.getItem(issueObject.self, 'issues');
        if (cached && cached.fields && cached.fields.updated < issueObject.fields.updated){ // discard if updated dated is newer than cached.
            cached = null;
        }
        if (cached && expansions && !cached.expanded){ // discard if expansions are required, but no expansions exists on cache.
            cached = null;
        }
        if (cached && expansions){
            for (let i=0; i<expansions.length; i++){ // discard if any of required expansions doesn't exists in cache.
                if (cached.expanded.indexOf(expansions[i]) == -1){
                    cached = false;
                    break;
                }
            }
            // TO-DO add previous selected expansions to refresh.
        }

        // If the cached value is correct, return it, else query API, recover response and store in cache.
        if (cached){
            response = cached;
        }else{
            response =  await this._request_jira_api( this.base_url + `rest/api/latest/issue/${issueObject.id}?`, 'issues');
            response.expanded = [];
            if ( expansions.indexOf("changelog")>=0 ){
                response.changelog =  await this._query_jira_api( this.base_url + `rest/api/latest/issue/${issueObject.id}/changelog/?`, 'values');
                response.expanded.push("changelog");
            }
            await this.indexed_db.setItem(issueObject.self, response, 'issues');
        }

        // If a callback function is set, call it.
        if (callbackFunction){callbackFunction(response);}

        // Mark as a resolved request.
        this._pending --;
        
        // Return the response.
        return response;
    }

    /**
     * Wait until all pending queries are done.
     */
    async flush(){
        while (this._pending > 0){await this._sleep();}
    }


    async changelog(issueObject){ // TODO Keep it for compatibility, deprecate it due expansions in issue() is a better and way to gather this information.
        return (await this.issue(issueObject, "changelog")).changelog;
    }

    /**
     * Download query from JIRA API
     * @param {string} queryURL URL to download
     * @param {string} resultType expected type of recived object (issue, values, etc..)
     * @param {function} statusFunction Function to call during page downloads
     * @param {string} statusLabel Label of the status function.
     * @returns object with the jira request result
     */
    async _query_jira_api(queryURL, resultType, statusFunction  = null, statusLabel = null){
        let downloadedPages = 0;
        let pageSize = 100;
        let currentPage = 0;
        let totalPages = 0;
        let pages = [];

        // Load all issues of this api request asyncronously.
        while (currentPage <= totalPages){
            let responseJSON = "";

            AP.request({
                /* jshint -W083 */ // ignore Functions declared within loops referencing an outer scoped variable may lead to confusing semantics.
                url:  queryURL+`&maxResults=${pageSize}&startAt=${currentPage*pageSize}`,
                dataType: "json",
                // Process server errors.
                error :   function(server_response) { _ujg_gft_generic_onError(server_response); }, 
                // Process server responses.
                success : function(server_response) {				
                    responseJSON = JSON.parse(server_response); 
                    pages[ (responseJSON.startAt / pageSize) ] = responseJSON;
                    downloadedPages++;	
                    // If a status function is indicated call it.
                    if (statusFunction) {statusFunction(downloadedPages, totalPages + 1, statusLabel);}
                }
            });

            // Wait for the first page to get info about how many pages to download.
            if (currentPage == 0) {
                while (downloadedPages == 0){await this._sleep();}
                totalPages = Math.ceil(pages[0].total / pageSize) - 1;
            }

            // If we arrive to the last page, wait until all are downloaded.
            if (currentPage == totalPages) {
                while (currentPage >= downloadedPages){await this._sleep();}
            }
            currentPage++;
        }

        // Prepare results with all the pages sorted.
        let result = pages[0];
        if (!result[resultType]) {result[resultType] = [];}
        for (let i=1; i<pages.length; i++){
            result[resultType] = result[resultType].concat(pages[i][resultType]);
        }
        return result;
    }

    /**
     * Non paginated single request to the JIRA API.
     * @param {*} requestURL URL to download
     * @returns object with the jira request result.
     */
    async _request_jira_api(requestURL){
        // Load all issues of this api request asyncronously.
        let response;

        // Send the request.
        AP.request({
            url:  requestURL,
            dataType: "json",
            // Process server errors.
            error :   function(server_response) { _ujg_gft_generic_onError(server_response); }, //TO-DO
            // Process server responses.
            success : function(server_response) {				
                response = JSON.parse(server_response); 
            }
        });
        
        // Wait until any response is recived.
        while (! response){await this._sleep();}
        return response;
    }


    /**
    * No-op sleep to wait until timeout is over
    * @param {integer} timeout milliseconds to wait.
    * @returns A promise that finishes passed the timeout.
    */
     async _sleep(timeout=null){return new Promise(r => setTimeout(r, timeout));
     }
}
