# timething

At this stage `timething` only uses "Personal access tokens". Visit [https://id.getharvest.com/developers] to create your "Personal access tokens".

If you click on the new token in the list you will be able to get your access token.  To get your Harvest ID click on the "Choose account" dropdown and select a Harvest Account. To get your Forecast ID click on the "Choose account" dropdown and select a Forecast Account. 

**NB! `timething` requires both the Harvest and Forecast account identifiers.  It is also expected that these two accounts are in the same organisation for them to be connected.**

To configure `timething` with your "Personal access tokens" run:

```
npx timething config
```

`timething` caches the fetched projects from Forecast. If you dont see your projects show up you can flush this cache with:

```
npx timething update-projects
```

To get your current week's timesheet run:

```
npx timething
```

To get your timesheet for a date range run:

```
npx timething [yyyy-mm-dd] [yyyy-mm-dd]
```

## For Fun Project  

If you are using this, you are using this because you are curious. I am not taking feature requests and I will not be providing support. I made this because it is helpful to my workflows and if it benefits anyone else that is a bonus. You are on your own, however, but I am open to pull requests.