import os
import re

def replace_in_file(filepath):
    with open(filepath, 'r') as f:
        content = f.read()

    new_content = content.replace('project_api', 'campaign_api')
    new_content = new_content.replace('ProjectSummary', 'CampaignSummary')
    new_content = new_content.replace('ProjectTreeResponse', 'CampaignTreeResponse')
    new_content = new_content.replace('project_chat', 'campaign_chat')
    new_content = new_content.replace('project_id', 'campaign_id')
    new_content = new_content.replace('projectId', 'campaignId')
    new_content = new_content.replace('projects', 'campaigns')
    new_content = new_content.replace('Projects', 'Campaigns')
    new_content = new_content.replace('project', 'campaign')
    new_content = new_content.replace('Project', 'Campaign')
    new_content = new_content.replace('PROJECT', 'CAMPAIGN')

    if new_content != content:
        with open(filepath, 'w') as f:
            f.write(new_content)
        print(f"Updated {filepath}")

for root, _, files in os.walk('src'):
    for file in files:
        if file.endswith(('.ts', '.tsx')):
            replace_in_file(os.path.join(root, file))
