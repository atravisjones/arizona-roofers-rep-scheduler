import { GoogleGenAI, Type } from "@google/genai";
import { Job, Rep, ParsedJobsResult, Settings } from '../types';

// Initialize the Gemini AI model client
const ai = new GoogleGenAI({apiKey: process.env.API_KEY});

/**
 * Parses jobs from a pasted text block using the Gemini API.
 * @param text The raw text pasted by the user.
 * @param reps A list of available reps to check against.
 * @returns A promise resolving to jobs, a detected date, and any pre-assignments.
 */
export async function parseJobsFromText(
  text: string,
  reps: Rep[]
): Promise<ParsedJobsResult & { assignments: { jobId: string, repId: string, slotId: string }[] }> {
  const repNames = reps.map(r => ({ id: r.id, name: r.name }));

  const prompt = `
    Parse the following text which contains job scheduling information.
    Extract the schedule date, a list of jobs, and any pre-assignments mentioned.
    The date is usually at the top, like "Monday, Nov 20, 2023". If you find one, return it in YYYY-MM-DD format. If not, return null for the date.
    Each job has an address, a city, and sometimes notes with details like "Tile" or "2500sqft".
    A job might be pre-assigned to a rep, indicated by "-> Rep Name".
    
    Here is the list of valid reps: ${JSON.stringify(repNames)}

    Your task is to return a JSON object that strictly follows this schema. Do not add extra fields or explanations.

    Text to parse:
    ---
    ${text}
    ---
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                date: { type: Type.STRING, description: "The schedule date in YYYY-MM-DD format, or null.", nullable: true },
                jobs: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            id: { type: Type.STRING, description: "A unique ID for the job, e.g., 'job-1'." },
                            customerName: { type: Type.STRING, description: "The customer's name, or use the City if not available." },
                            address: { type: Type.STRING, description: "The full street address." },
                            city: { type: Type.STRING, description: "The city of the job." },
                            zipCode: { type: Type.STRING, description: "The 5-digit zip code if present.", nullable: true },
                            notes: { type: Type.STRING, description: "Any extra details about the job." },
                            originalTimeframe: { type: Type.STRING, description: "The original time slot text, e.g., '7:30am - 10am'." }
                        },
                        required: ["id", "customerName", "address", "city", "notes", "originalTimeframe"]
                    }
                },
                assignments: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            jobId: { type: Type.STRING, description: "The ID of the job being assigned." },
                            repId: { type: Type.STRING, description: "The ID of the rep it is assigned to." },
                            slotId: { type: Type.STRING, description: "The time slot ID (ts-1, ts-2, ts-3, ts-4)." }
                        },
                        required: ["jobId", "repId", "slotId"]
                    }
                }
            },
            required: ["date", "jobs", "assignments"]
        }
    }
  });

  const jsonText = response.text.trim();
  const result = JSON.parse(jsonText) as ParsedJobsResult & { assignments: { jobId: string, repId: string, slotId: string }[] };
  
  // Post-process to generate unique IDs if the model didn't
  result.jobs.forEach((job, index) => {
      job.id = `job-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 9)}`;
  });
  
  // Map job indices to new IDs in assignments
  result.assignments.forEach(assignment => {
      const originalJobId = assignment.jobId; // e.g., "job-1"
      const jobIndex = parseInt(originalJobId.split('-')[1], 10) - 1;
      if (result.jobs[jobIndex]) {
          assignment.jobId = result.jobs[jobIndex].id;
      }
  });

  return result;
}

/**
 * Uses Gemini to suggest optimal job assignments.
 * This is a placeholder for a more complex AI assignment logic.
 */
export async function assignJobsWithAi(
    reps: Rep[], 
    unassignedJobs: Job[], 
    selectedDay: string, 
    settings: Settings,
    addAiThought: (thought: string) => void
): Promise<{ assignments: { jobId: string, repId: string, slotId: string }[] }> {

  addAiThought("Analyzing reps, jobs, and constraints...");
  const prompt = `
    You are an expert dispatcher for a roofing company. Your goal is to create the most efficient schedule.
    Given a list of available reps, a list of unassigned jobs, and a set of rules, determine the best assignment for each job.
    
    Rules: ${JSON.stringify(settings)}
    Today is: ${selectedDay}

    Reps: ${JSON.stringify(reps.map(r => ({id: r.id, name: r.name, availability: r.availability, skills: r.skills, schedule: r.schedule, unavailableSlots: r.unavailableSlots})))}

    Unassigned Jobs: ${JSON.stringify(unassignedJobs)}

    Based on all this information, provide a list of assignments in a JSON object.
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview', // Using a more powerful model for complex reasoning
    contents: prompt,
    config: {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.OBJECT,
            properties: {
                assignments: {
                    type: Type.ARRAY,
                    items: {
                        type: Type.OBJECT,
                        properties: {
                            jobId: { type: Type.STRING },
                            repId: { type: Type.STRING },
                            slotId: { type: Type.STRING }
                        },
                        required: ["jobId", "repId", "slotId"]
                    }
                }
            },
            required: ["assignments"]
        }
    }
  });

  addAiThought("Received assignment plan from AI.");
  const jsonText = response.text.trim();
  return JSON.parse(jsonText);
}

/**
 * Uses Gemini to attempt to fix or verify addresses.
 */
export async function fixAddressesWithAi(
    jobs: Job[]
): Promise<{ jobId: string, correctedAddress: string }[]> {
  const prompt = `
    Given the following list of jobs with potentially incorrect or incomplete addresses in Arizona, please correct them to be valid, geocodable addresses.
    Return a JSON array of objects, where each object has "jobId" and "correctedAddress".
    If an address cannot be confidently corrected, prefix the correctedAddress with "Unverified: ".
    
    Jobs:
    ${JSON.stringify(jobs.map(j => ({id: j.id, address: j.address})))}
  `;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
        responseMimeType: "application/json",
        responseSchema: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    jobId: { type: Type.STRING },
                    correctedAddress: { type: Type.STRING }
                },
                required: ["jobId", "correctedAddress"]
            }
        }
    }
  });
  
  const jsonText = response.text.trim();
  return JSON.parse(jsonText);
}
