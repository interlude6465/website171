import re
path = '/home/engine/project/core_components.js'
with open(path, 'r') as f:
    content = f.read()

new_func = r'''function generateLicenceDates(dob) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const calculateForAnniversary = (year) => {
    const anniversary = new Date(year, dob.getMonth(), dob.getDate());
    
    // Window: [anniversary + 10 days, anniversary + 2 months]
    const start = new Date(anniversary);
    start.setDate(start.getDate() + 10);
    
    const end = new Date(anniversary);
    end.setMonth(end.getMonth() + 2);

    // Constraint: Never in the future
    let effectiveEnd = new Date(Math.min(end.getTime(), today.getTime()));
    
    // Constraint: At least 10 days before current date if current date falls within the 2-month window
    // The "2-month window" here refers to [anniversary, anniversary + 2 months]
    const windowEnd = new Date(anniversary);
    windowEnd.setMonth(windowEnd.getMonth() + 2);
    
    if (today >= anniversary && today <= windowEnd) {
      const tenDaysAgo = new Date(today);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      effectiveEnd = new Date(Math.min(effectiveEnd.getTime(), tenDaysAgo.getTime()));
    }

    if (effectiveEnd < start) return null;

    const diff = effectiveEnd.getTime() - start.getTime();
    const randomDate = new Date(start.getTime() + Math.random() * diff);
    randomDate.setHours(0, 0, 0, 0);
    return randomDate;
  };

  let issueDate = null;
  const currentYear = today.getFullYear();
  
  // Try current year anniversary first if it has happened
  const thisYearAnniversary = new Date(currentYear, dob.getMonth(), dob.getDate());
  if (thisYearAnniversary <= today) {
    issueDate = calculateForAnniversary(currentYear);
  }
  
  // If no issueDate (either anniversary hasn't happened or constraints couldn't be met), try previous year
  if (!issueDate) {
    issueDate = calculateForAnniversary(currentYear - 1);
  }
  
  // Final fallback (should not happen with 18+ age validation, but for safety)
  if (!issueDate) {
     issueDate = new Date(today);
     issueDate.setDate(issueDate.getDate() - 30);
  }

  const expiryDate = new Date(issueDate);
  expiryDate.setFullYear(expiryDate.getFullYear() + 10);

  const p1EndDate = new Date(issueDate);
  p1EndDate.setFullYear(p1EndDate.getFullYear() + 1);

  const formatDate = (date) => {
    const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return String(date.getDate()).padStart(2,'0') + ' ' + mn[date.getMonth()] + ' ' + date.getFullYear();
  };

  const issueStr = formatDate(issueDate);
  const p1Str = formatDate(p1EndDate);
  const expiryStr = formatDate(expiryDate);

  document.querySelectorAll('.dateIssue').forEach(el  => { el.textContent = issueStr;  });
  document.querySelectorAll('.dateP1End').forEach(el  => { el.textContent = p1Str;  });
  document.querySelectorAll('.dateExpiry').forEach(el => { el.textContent = expiryStr; });

  // Also update Personal Info sub-screen if they exist
  const piIssue = document.getElementById('piIssueDate');
  const piP1End = document.getElementById('piP1EndDate');
  const piExpiry = document.getElementById('piExpiryDate');
  if (piIssue) piIssue.textContent = issueStr;
  if (piP1End) piP1End.textContent = p1Str;
  if (piExpiry) piExpiry.textContent = expiryStr;

  localStorage.setItem('dateIssue', issueStr);
  localStorage.setItem('dateP1End', p1Str);
  localStorage.setItem('dateExpiry', expiryStr);
  
  return true;
}'''

# Match the existing (partially broken) function
pattern = r'function generateLicenceDates\(dob\) \{.*?^\}'
new_content = re.sub(pattern, new_func, content, flags=re.DOTALL | re.MULTILINE)

with open(path, 'w') as f:
    f.write(new_content)
