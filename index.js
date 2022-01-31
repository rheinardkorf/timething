#!/usr/bin/env node

const r2 = require("r2");
const dotenv = require("dotenv");
const fs = require('fs');
const os = require('os');
const readline = require('readline');
const mkdirp = require('mkdirp');

const projectConfigPath = `${os.homedir}/.timething`;
const projectConfig = `${projectConfigPath}/config`;

// Ensure config directory exists.
mkdirp.sync(projectConfigPath); 

dotenv.config({ path: projectConfig });

const apiOptions = {
    protocol: "https",
    hostname: "api.forecastapp.com",
    path: "/",
    headers: {
        "User-Agent": "Node.js Forecast API Sample",
        "Authorization": "Bearer " + process.env.HARVEST_ACCESS_TOKEN,
        "Forecast-Account-ID": process.env.FORECAST_ACCOUNT_ID,
        "Harvest-Account-ID": process.env.HARVEST_ACCOUNT_ID
    }
}

// START DATE FUNCTIONS.

const formattedDate = (date) => {
    const parts = date.split('-');
    return `${parts[1]}/${parts[2]}/${parts[0]}`;
}

const leadingZeroes = (num, places = 2) => {
    var zero = places - num.toString().length + 1;
    return Array(+(zero > 0 && zero)).join("0") + num;
}

const yyyymmdd = (date) => {
    if (!date) {
        return null;
    }
    return date.getFullYear() + "-" + leadingZeroes((date.getMonth() + 1)) + "-" + leadingZeroes(date.getDate());
}

const getWeekPeriod = (date) => {
    date = date || new Date();
    const diff = date.getDate() - date.getDay() + (date.getDay() === 0 ? -6 : 1);

    return {
        start: yyyymmdd(new Date(date.setDate(diff - 1))),
        end: yyyymmdd(new Date(date.setDate(diff + 5))),
    }
}

const workDays = (date1, date2) => {
    const d1 = new Date(formattedDate(date1)).getTime();
    const d2 = new Date(formattedDate(date2)).getTime();
    const calc = Math.round((d2 - d1 + 10) / (1000 * 60 * 60 * 24));
    const weekendDays = (Math.trunc(calc / 5)) * 2;
    // Add 1 for inclusive days.
    return calc - weekendDays + 1;
}

// END DATE FUNCTIONS.

// MATH FUNCTIONS.

const round = (num, places = 2) => {
    return Math.round(num * Math.pow(10, places)) / Math.pow(10, places);
}

// END MATH FUNCTIONS.

// STDIN/STDOUT FUNCTIONS.

const readLineAsync = () => {
    const rl = readline.createInterface({
        input: process.stdin
    });

    return new Promise((resolve) => {
        rl.prompt();
        rl.on('line', (line) => {
            rl.close();
            resolve(line);
        });
    });
};

// END STDIN/STDOUT FUNCTIONS.


const request = async (path, options = {}) => {

    const mergedOptions = { ...apiOptions, ...options };
    const { protocol, hostname, path: urlPath, headers } = mergedOptions;

    const res = await r2(`${protocol}://${hostname}${urlPath}${path}`, mergedOptions);

    const result = await (await res.response).json();

    if (result.current_user) {
        return result.current_user;
    }

    return result;
}

const forecast = async (path, options = {}) => {
    return await request(path, options);
}

const harvest = async (path, options = {}) => {
    return await request(path, {
        ...options,
        hostname: "api.harvestapp.com",
        path: "/v2/"
    });
}

const forecastId = async () => {
    const result = await forecast('whoami');
    if (result.id) {
        return result.id;
    }

    return false;
}

const harvestId = async () => {
    const result = await harvest('users/me');
    if (result.id) {
        return result.id;
    }

    return false;
}

const getProjects = async (force) => {
    const projectsFile = './data/projects.json';

    let projects = { projects: [] };

    // Attempt to get it from a file. Setting force to true will skip this.
    if (!force && fs.existsSync(projectsFile)) {
        try {
            projects = JSON.parse(fs.readFileSync(projectsFile));
            return projects;
        } catch (error) { }
    }

    // Get projects from the API and save to file.
    try {
        projects = await forecast('projects');
        fs.writeFileSync(projectsFile, JSON.stringify(projects));
        return projects;
    } catch (error) { }

    // If we get here, we failed to get the projects.
    return projects;
}

const getProjectsBy = async (service = 'forecast') => {
    const rawProjects = await getProjects();
    let harvestProjects = {};

    const service_id = service === 'forecast' ? 'id' : 'harvest_id';

    rawProjects.projects.forEach(project => {
        if (project.harvest_id && !project.archived) {
            harvestProjects[project[service_id]] = {
                id: project.id,
                name: project.name,
                code: project.code,
                harvestId: project.harvest_id,
                startDate: project.start_date,
                endDate: project.end_date,
            };
        }
    });
    return harvestProjects;
}


const getAssignments = async (forecast_id, dateStart, dateEnd) => {
    let user_id;
    if (!forecast_id) {
        user_id = await forecastId();
    } else {
        user_id = forecast_id;
    }

    const thisWeek = getWeekPeriod();
    const periodStart = yyyymmdd(dateStart) || thisWeek.start;
    const periodEnd = yyyymmdd(dateEnd) || thisWeek.end;

    const query = `/assignments?person_id=${user_id}&start_date=${periodStart}&end_date=${periodEnd}`;
    const result = await forecast(query);

    if (result.assignments) {

        projects = await getProjectsBy('forecast');
        let assignments = {};

        result.assignments.forEach(assignment => {
            const project = projects[assignment.project_id] || {};
            assignments[assignment.project_id] = {
                project: project.name,
                projectCode: project.code,
                projectId: project.id,
                harvestId: project.harvestId,
                startDate: assignment.start_date,
                endDate: assignment.end_date,
                projectStartDate: project.startDate,
                projectEndDate: project.endDate
            }
            assignments[assignment.project_id].days = workDays(assignments[assignment.project_id].startDate, assignments[assignment.project_id].endDate);

            // Need to calculate total allocation in a period in the case of multiple assignments.
            assignments[assignment.project_id].periodAllocation = assignments[assignment.project_id].periodAllocation ? assignments[assignment.project_id].periodAllocation + assignment.allocation * assignments[assignment.project_id].days : assignment.allocation * assignments[assignment.project_id].days;

            // Allocation ends up being a daily average for the period.
            assignments[assignment.project_id].allocation = assignments[assignment.project_id].periodAllocation / assignments[assignment.project_id].days;
            assignments[assignment.project_id].allocationHours = assignments[assignment.project_id].allocation / 60 / 60;
        });

        return Object.values(assignments);
    }

    return;
}

const getTimeEntries = async (harvest_id, dateStart, dateEnd) => {
    let user_id;
    if (!harvest_id) {
        user_id = await harvestId();
    } else {
        user_id = harvest_id;
    }

    const thisWeek = getWeekPeriod();
    const periodStart = yyyymmdd(dateStart) || thisWeek.start;
    const periodEnd = yyyymmdd(dateEnd) || thisWeek.end;

    const timeEntries = [];
    let pages = 100;
    let page = 1;
    let perPage = 100;

    while (page <= pages && page > 0) {
        const query = `/time_entries?user_id=${user_id}&from=${periodStart}&to=${periodEnd}&page=${page}&per_page=${perPage}`;
        const result = await harvest(query);

        if (result.time_entries) {
            result.time_entries.forEach(entry => {
                timeEntries.push(entry);
            });
        }

        pages = result.total_pages;
        page++;
    }

    return timeEntries;
}

const getHarvestProjects = async () => {
    const projects = [];
    const pivotProjects = {};
    let pages = 100;
    let page = 1;
    let per_page = 100;

    while (page <= pages) {
        const res = await harvest(`users/me/project_assignments?per_page=${per_page}&page=${page}`);
        pages = res.total_pages;
        projects.push(...res.project_assignments);
        page = res.page + 1;
    }

    const projectDetails = projects.map(p => {
        return {
            assignment_id: p.id,
            project_id: p.project.id,
            project_name: p.project.name,
            project_code: p.project.code,
            client_id: p.client.id,
            client_name: p.client.name,
            tasks: p.task_assignments.map(t => {
                return {
                    assignment_id: t.id,
                    task_id: t.task.id,
                    task_name: t.task.name,
                    billable: t.billable,
                }
            })
        }
    });

    projectDetails.forEach(p => {
        if (!pivotProjects[p.client_id]) {
            pivotProjects[p.client_id] = {
                client_id: p.client_id,
                client_name: p.client_name,
                projects: [],
                project_details: {}
            }
        }
        pivotProjects[p.client_id].projects.push(p.project_name);
        pivotProjects[p.client_id].project_details[p.project_id] = {
            id: p.project_id,
            name: p.project_name,
            code: p.project_code,
            tasks: p.tasks
        };
    });

    return pivotProjects;
}

const addTimeEntries = async (projects, entries) => {

    entries.forEach(entry => {
        if (projects[entry.client.id].project_details[entry.project.id].timeEntries) {
            projects[entry.client.id].project_details[entry.project.id].timeEntries.push(entry)
        } else {
            projects[entry.client.id].project_details[entry.project.id].timeEntries = [entry];
        }
    });

    Object.values(projects).forEach(client => {
        Object.values(client.project_details).forEach(project => {
            let totalHours = 0;
            projects[client.client_id].project_details[project.id].totalHours = totalHours;
            projects[client.client_id].project_details[project.id].totalSeconds = Math.round(totalHours * 60 * 60);

            if (project.timeEntries) {
                project.timeEntries.forEach(entry => {
                    totalHours += entry.hours;
                });
                projects[client.client_id].project_details[project.id].totalHours = totalHours;
                projects[client.client_id].project_details[project.id].totalSeconds = Math.round(totalHours * 60 * 60);
            }
        });
    });

    return projects;
}

const addAssignmentAllocations = async (projects, assignments) => {

    assignments.forEach(assignment => {
        if (assignment.harvestId) {
            clientId = getHarvestClientId(assignment.harvestId, projects);
            projects[clientId].project_details[assignment.harvestId].allocation = assignment.allocation;
            projects[clientId].project_details[assignment.harvestId].days = assignment.days;
            projects[clientId].project_details[assignment.harvestId].periodAllocation = assignment.periodAllocation;
            projects[clientId].project_details[assignment.harvestId].allocationProgress = projects[clientId].project_details[assignment.harvestId].totalSeconds / assignment.periodAllocation;
        }
    });

    return projects;
}

const getHarvestClientId = (projectId, projects) => {
    let clientId = false;

    Object.values(projects).forEach(client => {
        Object.values(client.project_details).forEach(project => {
            if (project.id == projectId) {
                clientId = client.client_id;
            }
        });
    });

    return clientId;
}

const go = async () => {

    const command = process.argv[2] || "summary";

    if (command == "update-projects") {
        const projects = await getProjects(true);
        console.log("Forecast projects list updated.");
        return;
    }

    if (command == "config") {

        // Read console for the HARVEST_ACCOUNT_ID.
        console.log("Please enter your Harvest account ID:");
        const harvest_account_id = await readLineAsync();

        // Read console for the FORECAST_ACCOUNT_ID.
        console.log("Please enter your Forecast account ID:");
        const forecast_account_id = await readLineAsync();

        // Read console for the HARVEST_ACCESS_TOKEN.
        console.log("Please enter your Harvest access token:");
        const harvest_access_token = await readLineAsync();

        // Write config file.
        const configString = `HARVEST_ACCESS_TOKEN=${harvest_access_token}
HARVEST_ACCOUNT_ID=${harvest_account_id}
FORECAST_ACCOUNT_ID=${forecast_account_id}`;

        fs.writeFileSync(projectConfig, configString);

        return;
    }

    const forecast_id = await forecastId();
    const harvest_id = await harvestId();

    if (!forecast_id || !harvest_id) {
        console.log("Please run 'timething config' to configure the Harvest and Forecast accounts.");
        return;
    }

    // Check if argv has at least three arguments.
    if (process.argv.length >= 3) {
        start = new Date(process.argv[process.argv.length - 2]);
        end = new Date(process.argv[process.argv.length - 1]);
    } else {
        const p = getWeekPeriod(new Date());
        start = new Date(p.start);
        end = new Date(p.end);
    }

    const assignments = await getAssignments(forecast_id, start, end);

    // Get projects from Harvest.
    const harvestProjects = await getHarvestProjects();

    // Get all Timesheet entries.
    const timeEntries = await getTimeEntries(harvest_id, start, end);

    // Add timesheet entries to projects.
    const projectsWithTime = await addTimeEntries(harvestProjects, timeEntries);

    // Add assignment allocations to projects. Also adds current progress for the project.
    const projectsWithAssignments = await addAssignmentAllocations(projectsWithTime, assignments);

    let totalHoursLogged = 0.0;
    Object.values(projectsWithAssignments).forEach(client => {
        Object.values(client.project_details).forEach(project => {

            if (project.allocation && project.allocation > 0) {
                console.log(`============================================================`);
                console.log(`${project.code} / ${project.name} (${project.id})`);
                console.log(`------------------------------------------------------------`);
                console.log(`Logged: ${round(project.totalHours)} hours`);
                console.log(`Allocated Daily: ${round(project.allocation / 60 / 60)} hours`);
                console.log(`Utilization: ${round(project.allocationProgress * 100)}%`);
                console.log(`Remaining Hours: ${round(project.allocation / 60 / 60 * project.days - project.totalHours)} hours`);
                console.log(`------------------------------------------------------------\n`);
                totalHoursLogged += project.totalHours;
            }
        });
    });
    console.log(`Total Hours Logged: ${round(totalHoursLogged)} hours`);
}

go();