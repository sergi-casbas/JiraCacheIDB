class JiraCachedDB {
    constructor(base_url="/") {
        this.base_url = base_url;
        this.indexed_db = new IndexedDBStorage('JiraCachedDB');
    }
    
    async open (){
        await this.indexed_db.open(['issues', 'changelogs'], 1);
    }
    
    async JQLQuery(JQL, statusFunction=null, statusArray=null, resultType="issues"){
        return await this._query_jira_api( this.base_url + "rest/api/latest/search?fields=id,updated&jql=" + JQL, resultType, statusFunction, statusArray);
    }

    async issue(issueObject){
        let response = {};

        // Check if item in the cache is expired or is valid.
        let cached = await this.indexed_db.getItem(issueObject.self, 'issues');
        if (cached && cached.fields && cached.fields.updated < issueObject.fields.updated) {
            cached = null;
        }

        // If the cached value is correct, return it, else query API, recover response and store in cache.
        if (cached){
            response = cached;
        }else{
            response =  await this._request_jira_api( this.base_url + `rest/api/latest/issue/${issueObject.id}?`, 'issues');
            await this.indexed_db.setItem(issueObject.self, response, 'issues');
        }

        return response;
    }

    async changelog(issueObject){
        let response = {};

        // Check if item in the cache is expired or is valid.
        let cached = await this.indexed_db.getItem(issueObject.self, 'changelogs');
        if (cached && cached.fields && cached.fields.updated < issueObject.fields.updated) {
            cached = null;
        }

        // If the cached value is correct, return it, else query API, recover response and store in cache.
        if (cached){
            response = cached;
        }else{
            response =  await this._query_jira_api( this.base_url + `rest/api/latest/issue/${issueObject.id}/changelog/?`, 'values');
            await this.indexed_db.setItem(issueObject.self, response, 'changelogs');
        }

        return response;
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
                url:  queryURL+`&maxResults=${pageSize}&startAt=${currentPage*pageSize}`,
                dataType: "json",
                // Process server errors.
                error :   function(server_response) { _ujg_gft_generic_onError(server_response); }, //TO-DO
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
